import type { ReactNode } from "react";
import type { AnswerSentence, FinalAnswer } from "@shared/types";
import { SUPPORT_LABEL, SUPPORT_WORD, percent, supportFor } from "@/lib/labels";
import { rawValue } from "@/lib/render";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  answer: FinalAnswer;
  hoveredId: string | null;
  onHoverCase: (id: string | null) => void;
  onOpenCase: (id: string, cite?: { quote: string; chunkId: string }) => void;
}

const MARKER = /\[(\d{1,2})\]/g;

function sentenceForMarker(sentences: AnswerSentence[], marker: number): AnswerSentence | undefined {
  return sentences.find((s) => s.marker === marker) ?? sentences[marker - 1];
}

/** Answer prose with each [n] turned into a button that points at its case. */
function renderProse(answer: FinalAnswer, onHoverCase: Props["onHoverCase"], onOpenCase: Props["onOpenCase"]): ReactNode[] {
  const nodes: ReactNode[] = [];
  const text = answer.text;
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(MARKER)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(text.slice(last, index));
    const marker = Number(match[1]);
    const sentence = sentenceForMarker(answer.sentences, marker);
    const caseId = sentence?.case_id ?? null;
    const state = supportFor(sentence?.accepted ?? null, sentence?.calibrated_prob ?? null);
    nodes.push(
      <button
        key={`m${key++}`}
        type="button"
        disabled={!caseId}
        onMouseEnter={() => caseId && onHoverCase(caseId)}
        onMouseLeave={() => onHoverCase(null)}
        onFocus={() => caseId && onHoverCase(caseId)}
        onBlur={() => onHoverCase(null)}
        onClick={() => {
          if (caseId) onOpenCase(caseId, { quote: sentence?.quote ?? "", chunkId: sentence?.chunk_id ?? "" });
        }}
        title={
          caseId
            ? `${sentence?.case_name ?? caseId} — ${SUPPORT_WORD[state]}${state === "pending" ? "" : ` (${percent(sentence?.calibrated_prob ?? null)})`}`
            : "No case behind this marker"
        }
        className={cn(
          "mx-0.5 rounded border px-1 py-0 align-baseline text-[0.7rem] font-semibold tabular-nums transition-colors",
          state === "supported" && "border-ok/60 bg-ok/10 text-ok",
          state === "unsupported" && "border-bad/60 bg-bad/10 text-bad",
          state === "pending" && "border-pending/60 bg-pending/10 text-ink-dim",
          caseId ? "cursor-pointer hover:bg-navy-700" : "cursor-not-allowed opacity-60",
        )}
      >
        {match[1]}
        <span className="sr-only">
          {caseId
            ? ` — ${sentence?.case_name ?? "case"}, ${SUPPORT_WORD[state]}. Open the opinion.`
            : " — no case behind this marker."}
        </span>
      </button>,
    );
    last = index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Chip({ accepted, prob }: { accepted: boolean | null; prob: number | null }) {
  const state = supportFor(accepted, prob);
  return (
    <Badge
      className={cn(
        "shrink-0 border text-[0.68rem]",
        state === "supported" && "border-ok/50 bg-ok/10 text-ok",
        state === "unsupported" && "border-bad/50 bg-bad/10 text-bad",
        state === "pending" && "border-pending/50 bg-pending/10 text-ink-dim",
      )}
      variant="neutral"
    >
      {SUPPORT_LABEL[state]}
    </Badge>
  );
}

export default function AnswerView({ answer, hoveredId, onHoverCase, onOpenCase }: Props) {
  const cited = answer.cited_cases ?? [];
  const noAnswer = !answer.text.trim() && answer.sentences.length === 0;
  const writerFailed = noAnswer && Boolean(answer.writer_error);
  const confidenceRaw = answer.sentences.filter((s) => typeof s.calibrated_prob === "number").length;

  return (
    <div className="space-y-5">
      {answer.abstain && !writerFailed ? (
        <div
          role="status"
          className="rounded-lg border border-gold/40 bg-gold/10 p-3 text-sm text-gold"
        >
          The checker was not confident enough to stand behind this answer. Read it as a shortlist of
          passages, not as a conclusion.
          {confidenceRaw === 0 ? " No statement here was verified." : ""}
        </div>
      ) : null}

      {!answer.checked && !writerFailed ? (
        <p className="rounded-lg border border-navy-700 bg-navy-900/70 p-3 text-sm text-ink-dim">
          The checker could not be reached, so none of these statements were verified.{" "}
          {answer.check_error ? `Reason given: ${answer.check_error}.` : ""} Treat every sentence as
          unverified and read the opinions yourself.
        </p>
      ) : null}

      {noAnswer ? (
        <p className="rounded-lg border border-navy-700 bg-navy-900/70 p-3 text-sm text-ink-dim">
          {answer.writer_error
            ? `${answer.writer_error} The passages found are listed below.`
            : "Nothing in the stored opinions answered this question, so there is no answer to show. The passages found are listed below."}
        </p>
      ) : (
        <section aria-labelledby="answer-heading">
          <h2 id="answer-heading" className="headline mb-2 text-lg">
            The answer
          </h2>
          <p className="max-w-prose font-serif text-[1.06rem] leading-[1.75] text-ink">
            {renderProse(answer, onHoverCase, onOpenCase)}
          </p>
          {answer.model && answer.answer_source === "model" ? (
            <p className="mt-2 text-xs text-ink-mute">
              Written from the passages above using {answer.model}. Sentences that did not match a quote
              were dropped.
            </p>
          ) : null}
        </section>
      )}

      <section aria-labelledby="confidence-heading" className="card-surface p-4">
        <h2 id="confidence-heading" className="eyebrow mb-2">
          Overall confidence
        </h2>
        <p className="text-sm text-ink">
          {answer.answer_confidence === null || answer.answer_confidence === undefined
            ? "The checker did not return an overall confidence number."
            : `${percent(answer.answer_confidence)} (reported as ${rawValue(answer.answer_confidence)})`}
        </p>
        {typeof answer.answer_confidence === "number" ? (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-navy-700">
            <div
              className={cn(
                "h-full rounded-full",
                answer.abstain ? "bg-gold" : "bg-cyan",
              )}
              style={{ width: `${Math.max(2, Math.min(100, answer.answer_confidence * 100))}%` }}
            />
          </div>
        ) : null}
        <p className="mt-2 text-xs text-ink-mute">
          {writerFailed
            ? "The checker did not run, because the answer writer produced no statement."
            : answer.abstain
              ? "Abstain: yes — the checker withheld this answer."
              : "Abstain: no"}
          {answer.timings?.total_ms !== undefined ? ` · whole search ${rawValue(answer.timings.total_ms)} ms` : ""}
          {`. ${answer.sentences.length} statement${answer.sentences.length === 1 ? "" : "s"} in the answer.`}
        </p>
      </section>

      {answer.sentences.length ? (
        <section aria-labelledby="claims-heading">
          <h2 id="claims-heading" className="eyebrow mb-2">
            Statement by statement
          </h2>
          <ol className="space-y-2">
            {answer.sentences.map((sentence, index) => {
              const verified = answer.quotes_verified?.[index];
              return (
                <li
                  key={index}
                  className={cn(
                    "card-surface p-3",
                    hoveredId && hoveredId === sentence.case_id && "border-cyan/60",
                  )}
                  onMouseEnter={() => onHoverCase(sentence.case_id)}
                  onMouseLeave={() => onHoverCase(null)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 font-serif text-[0.98rem] leading-relaxed text-ink">
                      {sentence.text}
                      {sentence.marker !== null ? <span className="text-cyan-soft"> [{sentence.marker}]</span> : null}
                    </p>
                    <Chip accepted={sentence.accepted} prob={sentence.calibrated_prob} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-mute">
                    <span>
                      Probability the quote supports this:{" "}
                      {sentence.calibrated_prob === null || sentence.calibrated_prob === undefined
                        ? "not returned"
                        : rawValue(sentence.calibrated_prob)}
                    </span>
                    {sentence.accepted !== null ? (
                      <span>Checker verdict: {sentence.accepted ? "accepted" : "rejected"}</span>
                    ) : null}
                    {verified !== undefined ? (
                      <span>Quote found word-for-word: {verified ? "yes" : "no"}</span>
                    ) : null}
                    {sentence.case_id ? (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs text-cyan-soft"
                        onClick={() =>
                          onOpenCase(sentence.case_id!, { quote: sentence.quote, chunkId: sentence.chunk_id })
                        }
                      >
                        Show this passage in {sentence.case_name ?? sentence.case_id}
                      </Button>
                    ) : (
                      <span>No case attached to this statement</span>
                    )}
                  </div>
                  {sentence.quote ? (
                    <blockquote className="mt-2 border-l-2 border-cyan/40 pl-3 text-sm italic leading-relaxed text-ink-dim">
                      “{sentence.quote}”
                    </blockquote>
                  ) : (
                    <p className="mt-2 text-xs text-bad">No quote was recorded for this statement.</p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      {cited.length ? (
        <section aria-labelledby="cited-heading">
          <h2 id="cited-heading" className="eyebrow mb-2">
            Cited cases ({cited.length})
          </h2>
          <ul className="space-y-2">
            {cited.map((c) => (
              <li
                key={c.case.id}
                className={cn("card-surface p-3", hoveredId === c.case.id && "border-cyan/60")}
                onMouseEnter={() => onHoverCase(c.case.id)}
                onMouseLeave={() => onHoverCase(null)}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenCase(c.case.id)}
                    className="text-left font-serif text-[1.02rem] text-ink hover:text-cyan-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
                  >
                    {c.case.name || c.case.id}
                  </button>
                  <span className="text-xs tabular-nums text-ink-mute">
                    rank {rawValue(c.rank)} · score {rawValue(c.score)}
                    {c.score_kind ? ` (${c.score_kind})` : ""}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-ink-mute">
                  {[c.case.court, c.case.year].filter(Boolean).join(" · ") || "Court and year not returned"}
                </p>
                {c.spans.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {c.spans.map((span, i) => (
                      <li key={`${span.chunk_id}-${i}`}>
                        <button
                          type="button"
                          onClick={() => onOpenCase(c.case.id, { quote: span.text, chunkId: span.chunk_id })}
                          className="w-full rounded-md border border-navy-700/70 bg-navy-950/60 p-2 text-left text-sm italic leading-relaxed text-ink-dim hover:border-cyan/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
                        >
                          “{span.text}”
                          <span className="mt-1 block font-sans text-[0.68rem] not-italic text-ink-mute">
                            Passage {span.chunk_id} · characters {rawValue(span.start)}–{rawValue(span.end)} ·
                            click to open the opinion with this span highlighted
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ink-mute">The engine did not return a span for this case.</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cited.length ? (
        <section aria-labelledby="why-heading" className="card-surface p-4">
          <h2 id="why-heading" className="eyebrow mb-1">
            Why these cases
          </h2>
          <p className="mb-3 text-xs text-ink-mute">
            Straight from the engine&apos;s own provenance notes — nothing added.
          </p>
          <ul className="space-y-2">
            {cited.map((c) => (
              <li key={`why-${c.case.id}`} className="text-sm">
                <span className="font-serif text-ink">{c.case.name || c.case.id}</span>
                {c.provenance?.length ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink-dim">
                    {c.provenance.map((note, i) => (
                      <li key={i}>{note}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs text-ink-mute">No provenance was returned for this case.</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {answer.dropped?.length ? (
        <details className="card-surface p-3">
          <summary className="cursor-pointer text-sm text-ink-dim">
            Sentences left out ({answer.dropped.length}) — they did not match their quote
          </summary>
          <ul className="mt-2 space-y-2 text-xs text-ink-mute">
            {answer.dropped.map((d, i) => (
              <li key={i}>
                <span className="text-ink-dim">{d.text}</span>
                <span className="block">Left out because: {d.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
