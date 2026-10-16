import { FREE_CHECKER_MODELS, FREE_WRITER_MODELS, ollama, openrouter } from "./config";
import { enginePost, EngineError } from "./engine";
import type {
  AnswerSentence,
  CitedCase,
  ClaimInput,
  CheckResponse,
  DroppedSentence,
  FinalAnswer,
  RetrievalResult,
} from "../shared/types";

export class WriterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriterError";
  }
}

const PER_PASSAGE_CHARS = 1100;
const PROMPT_BUDGET_CHARS = 11000;

/* ------------------------------------------------------------------ model */

let cachedModel: string | null = null;
let modelGap: string | null = null;

const WRITER_UNREACHABLE = "No local model is reachable on the answer writer endpoint.";
const WRITER_EMPTY =
  "Ollama is running, but no model is installed, so no answer was written and the checker had nothing to score.";

async function fetchTags(): Promise<string[]> {
  const res = await fetch(`${ollama.baseUrl()}/api/tags`, {
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new WriterError(`The answer writer is not reachable (HTTP ${res.status}).`);
  const json = await res.json().catch(() => null);
  const models = Array.isArray(json?.models) ? json.models : [];
  return models.map((m: any) => String(m?.name ?? "")).filter(Boolean);
}

/** Embedding models show up in `ollama list` but refuse `/api/chat`. */
function canWrite(name: string): boolean {
  return !/embed/i.test(name);
}

/** The model actually used for writing, or null if none can be resolved. */
export async function resolveModel(): Promise<string | null> {
  if (cachedModel) {
    modelGap = null;
    return cachedModel;
  }
  const wanted = ollama.model();
  let names: string[] = [];
  try {
    names = await fetchTags();
  } catch (err) {
    if (wanted && canWrite(wanted)) return wanted;
    modelGap = WRITER_UNREACHABLE;
    console.error("[api] ollama tags unavailable:", (err as Error).message);
    return null;
  }
  const pick = wanted
    ? names.find((n) => n === wanted || n.startsWith(`${wanted}:`)) ?? wanted
    : names.find((n) => canWrite(n)) ?? "";
  if (!pick || !canWrite(pick)) {
    cachedModel = null;
    modelGap = names.length
      ? "Ollama is running, but the installed model cannot write answers."
      : WRITER_EMPTY;
    return null;
  }
  cachedModel = pick;
  modelGap = null;
  return pick;
}

function answerText(message: { content?: unknown; reasoning?: unknown } | null): string {
  const content = message?.content;
  if (typeof content === "string" && content.trim()) return content;
  const reasoning = message?.reasoning;
  if (typeof reasoning === "string" && reasoning.includes("{")) return reasoning;
  return "";
}

/** One chat turn against a named free OpenRouter model. Skips a model that is rate-limited or empty. */
async function openrouterChat(
  models: readonly string[],
  system: string,
  user: string,
  maxTokens: number,
): Promise<{ model: string; text: string }> {
  const key = openrouter.apiKey();
  if (!key) throw new WriterError("OpenRouter is not configured.");
  let last = "No free model returned an answer.";
  for (const model of models) {
    if (model === "openrouter/free") continue;
    const attempt = async (disableReasoning: boolean): Promise<Response> =>
      fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature: 0,
          ...(disableReasoning ? { reasoning: { enabled: false } } : {}),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
    let res: Response;
    try {
      res = await attempt(true);
    } catch {
      last = `${model} did not answer in time.`;
      continue;
    }
    if (res.status === 400) {
      const detail = await res.text().catch(() => "");
      if (!detail.toLowerCase().includes("reasoning")) {
        throw new WriterError(`OpenRouter returned HTTP 400. ${detail.slice(0, 160)}`.trim());
      }
      try {
        res = await attempt(false);
      } catch {
        last = `${model} did not answer in time.`;
        continue;
      }
    }
    if (res.status === 429 || res.status === 502 || res.status === 503) {
      last = `${model} is rate-limited right now.`;
      continue;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new WriterError(`OpenRouter returned HTTP ${res.status}. ${detail.slice(0, 160)}`.trim());
    }
    const json = await res.json().catch(() => null);
    const text = answerText(json?.choices?.[0]?.message ?? null);
    if (text.trim()) return { model, text };
    last = `${model} returned no answer text.`;
  }
  throw new WriterError(last);
}

/** One chat turn, JSON forced, no network beyond the local endpoint. */
async function complete(prompt: string, model: string): Promise<string> {
  const res = await fetch(`${ollama.baseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(ollama.timeoutMs()),
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature: 0, top_p: 0.9, num_ctx: 8192 },
      messages: [
        {
          role: "system",
          content:
            "You write short, strictly grounded answers about case law. You never add facts that are not in the passages you are given.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new WriterError(
      `The answer writer failed (HTTP ${res.status}). ${detail.slice(0, 160)}`.trim(),
    );
  }
  const json = await res.json().catch(() => null);
  const text: string = json?.message?.content ?? json?.response ?? "";
  if (!String(text).trim()) throw new WriterError("The answer writer returned nothing.");
  return String(text);
}

/* -------------------------------------------------------------- prompting */

function passageBlock(results: RetrievalResult[]): string {
  const lines: string[] = [];
  let used = 0;
  for (const r of results) {
    for (const p of r.passages.slice(0, 2)) {
      const text = String(p.text ?? "").replace(/\s+/g, " ").trim().slice(0, PER_PASSAGE_CHARS);
      if (!text) continue;
      const head =
        `[${r.rank}] ${r.case.name} (${r.case.court || "court unknown"}, ${r.case.year ?? "year unknown"}) ` +
        `id=${r.case.id} chunk_id=${p.chunk_id}\n${text}\n`;
      if (used + head.length > PROMPT_BUDGET_CHARS) return lines.join("\n\n");
      used += head.length;
      lines.push(head);
    }
  }
  return lines.join("\n\n");
}

function buildPrompt(question: string, results: RetrievalResult[]): string {
  return [
    "Answer the question using ONLY the passages below. They are the only thing you know about this case law.",
    "",
    `Question: ${question}`,
    "",
    "Passages:",
    passageBlock(results),
    "",
    "Rules:",
    "- Write 3 to 6 sentences.",
    `- End every sentence with one bracketed marker that names a passage number above, e.g. [${results[0]?.rank ?? 1}].`,
    '- Include one exact quote inside double quotation marks in every sentence. Copy it character for character from the passage. Change nothing — no ellipses, no brackets, no changed letters.',
    "- Never state a holding, date, court or vote count that is not written in the passage you cite.",
    "- If the passages do not answer the question, write one sentence saying so and cite nothing.",
    "",
    'Reply with JSON only, in exactly this shape:',
    '{"sentences":[{"text":"The court …, stating "quote here" [2]","citation":"2","quote":"quote here","chunk_id":"the chunk_id you copied from"}]}',
  ].join("\n");
}

function extractJson(raw: string): any {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through and look for an object */
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* ignore */
    }
  }
  throw new WriterError("The answer writer returned something that was not JSON.");
}

/* ------------------------------------------------------------ validation */

interface DraftSentence {
  text: string;
  citation: string | null;
  quote: string;
  chunk_id: string;
}

function parseDraft(raw: string): DraftSentence[] {
  const value = extractJson(raw);
  const list = Array.isArray(value?.sentences)
    ? value.sentences
    : Array.isArray(value)
      ? value
      : [];
  return list
    .map((s: any): DraftSentence => ({
      text: String(s?.text ?? "").trim(),
      citation: s?.citation === null || s?.citation === undefined ? null : String(s.citation).trim(),
      quote: String(s?.quote ?? "").trim(),
      chunk_id: String(s?.chunk_id ?? "").trim(),
    }))
    .filter((s: DraftSentence) => s.text.length > 0);
}

function markerOf(sentence: DraftSentence, results: RetrievalResult[]): number | null {
  const candidates: string[] = [];
  if (sentence.citation) candidates.push(sentence.citation);
  const inText = sentence.text.match(/\[(\d{1,2})\]/g) ?? [];
  for (const token of inText) candidates.push(token.replace(/[[\]]/g, ""));
  for (const value of candidates) {
    const n = Number(value);
    if (!Number.isInteger(n)) continue;
    if (results.some((r) => r.rank === n)) return n;
  }
  return null;
}

/** Strips the trailing marker so it can be re-attached in one canonical place. */
function withTrailingMarker(text: string, marker: number): string {
  const stripped = text.replace(/\s*\[\d{1,2}\]\s*/g, " ").replace(/\s+/g, " ").trim();
  if (!stripped) return "";
  const withoutTailPunct = stripped.replace(/[.\s]+$/, "");
  return `${withoutTailPunct} [${marker}].`;
}

const STRAIGHT_QUOTE: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": "'",
  "\u201b": "'",
  "`": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u201e": '"',
  "\u201f": '"',
  "\u00ab": '"',
  "\u00bb": '"',
};

/**
 * Collapse whitespace to one space and curly quotes to straight ones.
 * `index[i]` is the original offset of folded character i, so a match can be
 * cut back out of the stored passage instead of out of the folded copy.
 */
function foldText(text: string): { folded: string; index: number[] } {
  const chars: string[] = [];
  const index: number[] = [];
  let pendingSpace = -1;
  const push = (ch: string, at: number) => {
    chars.push(ch);
    index.push(at);
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (chars.length && chars[chars.length - 1] !== " ") pendingSpace = i;
      continue;
    }
    if (pendingSpace >= 0) {
      push(" ", pendingSpace);
      pendingSpace = -1;
    }
    push(STRAIGHT_QUOTE[ch] ?? ch, i);
  }
  return { folded: chars.join(""), index };
}

function findQuote(
  quote: string,
  result: RetrievalResult,
  chunkId: string,
): { chunk_id: string; text: string; start: number; end: number } | null {
  const needle = foldText(quote.trim()).folded;
  if (!needle) return null;
  const preferred = chunkId
    ? result.passages.filter((p) => String(p.chunk_id) === chunkId)
    : result.passages;
  const pool = (preferred.length ? preferred : result.passages).slice();
  for (const passage of pool) {
    const body = String(passage.text);
    const exact = body.indexOf(quote);
    if (exact >= 0) {
      return {
        chunk_id: String(passage.chunk_id),
        text: quote,
        start: exact,
        end: exact + quote.length,
      };
    }
    const { folded, index } = foldText(body);
    const at = folded.indexOf(needle);
    if (at < 0) continue;
    const start = index[at];
    const end = index[at + needle.length - 1] + 1;
    const slice = body.slice(start, end);
    if (foldText(slice).folded !== needle) continue;
    return {
      chunk_id: String(passage.chunk_id),
      text: slice,
      start,
      end,
    };
  }
  return null;
}

export interface ValidatedAnswer {
  answer: FinalAnswer;
  claims: ClaimInput[];
}

export function validate(
  drafts: DraftSentence[],
  results: RetrievalResult[],
  question: string,
  meta: { model: string | null; compose_ms: number | null; startedAt: number },
): ValidatedAnswer {
  const kept: AnswerSentence[] = [];
  const dropped: DroppedSentence[] = [];
  const spansByRank = new Map<number, CitedCase["spans"]>();

  drafts.forEach((draft) => {
    const marker = markerOf(draft, results);
    if (marker === null) {
      dropped.push({
        text: draft.text,
        reason: draft.citation
          ? `marker [${draft.citation}] is not a returned case`
          : "no citation marker",
      });
      return;
    }
    const result = results.find((r) => r.rank === marker)!;
    const span = findQuote(draft.quote, result, draft.chunk_id);
    if (!span) {
      dropped.push({ text: draft.text, reason: `quote not found in the passages of ${result.case.name}` });
      return;
    }
    const text = withTrailingMarker(draft.text, marker);
    if (!text) {
      dropped.push({ text: draft.text, reason: "sentence was empty once the marker was removed" });
      return;
    }
    kept.push({
      index: kept.length,
      text,
      marker,
      case_id: result.case.id,
      case_name: result.case.name,
      quote: span.text,
      chunk_id: span.chunk_id,
      accepted: null,
      calibrated_prob: null,
    });
    const list = spansByRank.get(marker) ?? [];
    list.push(span);
    spansByRank.set(marker, list);
  });

  const citedCases: CitedCase[] = results
    .filter((r) => spansByRank.has(r.rank))
    .map((r) => ({
      rank: r.rank,
      case: r.case,
      score: r.score,
      score_kind: r.score_kind,
      provenance: r.provenance ?? [],
      spans: spansByRank.get(r.rank) ?? [],
    }))
    .sort((a, b) => a.rank - b.rank);

  const claims: ClaimInput[] = kept.map((s) => ({
    text: s.text,
    cited_text: s.quote,
    citation: s.case_id ?? "",
    chunk_id: s.chunk_id,
  }));

  const answer: FinalAnswer = {
    question,
    text: kept.map((s) => s.text).join(" "),
    sentences: kept,
    dropped,
    cited_cases: citedCases,
    answer_confidence: null,
    abstain: kept.length === 0,
    checked: false,
    check_error: null,
    answer_source: kept.length ? "model" : "none",
    model: meta.model,
    writer_error: null,
    timings: { compose_ms: meta.compose_ms, check_ms: null, total_ms: Date.now() - meta.startedAt },
  };

  return { answer, claims };
}

export interface ComposedAnswer extends ValidatedAnswer {
  model: string | null;
  compose_ms: number;
  writer_error: string | null;
}

/**
 * Writes the answer with the local model and validates every sentence against
 * the returned passages. Never throws: a writer failure comes back as
 * `writer_error` with zero kept sentences, which the UI shows as no answer.
 */
export async function composeAnswer(
  question: string,
  results: RetrievalResult[],
): Promise<ComposedAnswer> {
  const startedAt = Date.now();
  const model = await resolveModel();
  const empty = (error: string, ms: number): ComposedAnswer => ({
    answer: validate([], results, question, { model, compose_ms: ms, startedAt }).answer,
    claims: [],
    model,
    compose_ms: ms,
    writer_error: error,
  });

  if (!results.length) return empty("Nothing was retrieved, so there was nothing to write from.", Date.now() - startedAt);
  if (!model && !openrouter.configured()) return empty(modelGap ?? WRITER_UNREACHABLE, Date.now() - startedAt);

  try {
    let raw: string;
    let used = model;
    if (model) {
      raw = await complete(buildPrompt(question, results), model);
    } else {
      const chat = await openrouterChat(
        FREE_WRITER_MODELS,
        "You write short, strictly grounded answers about case law. You never add facts that are not in the passages you are given.",
        buildPrompt(question, results),
        900,
      );
      raw = chat.text;
      used = chat.model;
    }
    const compose_ms = Date.now() - startedAt;
    const drafts = parseDraft(raw);
    const { answer, claims } = validate(drafts, results, question, { model: used, compose_ms, startedAt });
    if (!claims.length) {
      const why = answer.dropped
        .map((row) => row.reason)
        .filter(Boolean)
        .slice(0, 2)
        .join("; ");
      const message = why
        ? `The answer writer’s sentences did not match the stored passages (${why}).`
        : "The answer writer returned no sentences.";
      return { answer, claims, model: used, compose_ms, writer_error: message };
    }
    return { answer, claims, model: used, compose_ms, writer_error: null };
  } catch (err) {
    return empty((err as Error).message || "The answer writer failed.", Date.now() - startedAt);
  }
}

function supportOf(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const unit = n > 1 && n <= 100 ? n / 100 : n;
  if (unit < 0 || unit > 1) return null;
  return unit;
}

/** Score each kept sentence with a named free model. Quotes were already matched locally. */
async function checkWithFreeModel(
  claims: ClaimInput[],
  answer: FinalAnswer,
  started: number,
): Promise<{ answer: FinalAnswer; ms: number }> {
  const lines = claims.map(
    (claim, index) => `${index}. sentence: ${claim.text}\n   quote: ${claim.cited_text}`,
  );
  const chat = await openrouterChat(
    FREE_CHECKER_MODELS,
    "You score whether a quote supports a sentence about case law. Reply with JSON only.",
    [
      "Give each sentence a support score from 0 to 1.",
      "1 means the quote states what the sentence says. 0 means the quote does not.",
      'Reply with JSON only: {"scores":[{"index":0,"support":0.0}]}',
      "",
      ...lines,
    ].join("\n"),
    400,
  );
  const parsed = extractJson(chat.text);
  const rows = Array.isArray(parsed?.scores) ? parsed.scores : [];
  const byIndex = new Map<number, number>();
  for (const row of rows) {
    const index = Number(row?.index);
    const support = supportOf(row?.support);
    if (Number.isInteger(index) && support !== null) byIndex.set(index, support);
  }
  const sentences = answer.sentences.map((sentence) => {
    const support = byIndex.get(sentence.index);
    return {
      ...sentence,
      accepted: support === undefined ? null : support >= 0.5,
      calibrated_prob: support === undefined ? null : support,
    };
  });
  const scored = sentences
    .map((sentence) => sentence.calibrated_prob)
    .filter((value): value is number => typeof value === "number");
  const confidence = scored.length ? Math.min(...scored) : null;
  return {
    answer: {
      ...answer,
      sentences,
      model: answer.model,
      answer_confidence: confidence,
      abstain: confidence === null || confidence < 0.5,
      checked: true,
      check_error: null,
      quotes_verified: sentences.map(() => true),
      timings: { ...answer.timings, check_ms: Date.now() - started },
    },
    ms: Date.now() - started,
  };
}

/** Send the surviving claims to the checker. */
export async function runCheck(
  claims: ClaimInput[],
  answer: FinalAnswer,
): Promise<{ answer: FinalAnswer; ms: number }> {
  const started = Date.now();
  if (!claims.length) {
    return {
      answer: { ...answer, checked: false, answer_confidence: null, abstain: true, timings: { ...answer.timings, check_ms: null } },
      ms: 0,
    };
  }
  try {
    if (openrouter.configured()) return await checkWithFreeModel(claims, answer, started);
    const payload = (await enginePost("/api/v1/check", { claims, scorer: "minicheck" })) as CheckResponse;
    const byIndex = new Map<number, { accepted: boolean | null; prob: number | null }>();
    for (const claim of payload?.claims ?? []) {
      byIndex.set(Number(claim.claim_index), {
        accepted: claim.accepted === null || claim.accepted === undefined ? null : Boolean(claim.accepted),
        prob:
          claim.calibrated_prob === null || claim.calibrated_prob === undefined
            ? null
            : Number(claim.calibrated_prob),
      });
    }
    const sentences = answer.sentences.map((s) => {
      const hit = byIndex.get(s.index);
      return { ...s, accepted: hit ? hit.accepted : null, calibrated_prob: hit ? hit.prob : null };
    });
    const quoteVerified = Array.isArray(payload?.quotes) ? payload.quotes : [];
    const confidence =
      payload?.answer_confidence === null || payload?.answer_confidence === undefined
        ? null
        : Number(payload.answer_confidence);
    return {
      answer: {
        ...answer,
        sentences,
        answer_confidence: Number.isFinite(confidence as number) ? confidence : null,
        abstain: Boolean(payload?.abstain) || sentences.length === 0,
        checked: true,
        check_error: null,
        quotes_verified: quoteVerified.length
          ? quoteVerified.map((q) => Boolean(q?.quote_verified))
          : undefined,
        timings: { ...answer.timings, check_ms: Date.now() - started },
      },
      ms: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof EngineError ? err.message : "The checker did not respond.";
    return {
      answer: {
        ...answer,
        checked: false,
        check_error: message,
        answer_confidence: null,
        timings: { ...answer.timings, check_ms: Date.now() - started },
      },
      ms: Date.now() - started,
    };
  }
}

export { buildPrompt, complete };
