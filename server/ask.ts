import type { IncomingMessage, ServerResponse } from "node:http";
import { engineRetrieve, EngineError } from "./engine";
import { Sse, readJsonBody, describeError } from "./http";
import { scrubQuestion } from "./pii";
import { composeAnswer, runCheck } from "./answer";
import { insertQueryLog } from "./db";
import { recordAsk } from "./langfuse";
import type { AskFailure, RetrievalResult, StageEvent, StageTiming } from "../shared/types";

const MAX_QUESTION = 400;

/** How many items a stage reported, whatever shape the engine used. */
function stageCount(stage: StageEvent): number | null {
  if (typeof stage.count === "number") return stage.count;
  for (const key of ["candidates", "edges", "added", "citations", "results"] as const) {
    const value = stage[key];
    if (Array.isArray(value)) return value.length;
  }
  for (const key of ["top_k", "hits", "items", "passages"] as const) {
    const value = stage[key];
    if (Array.isArray(value)) return value.length;
  }
  return null;
}

function toTiming(stage: StageEvent): StageTiming {
  return {
    stage: stage.stage,
    duration_ms: typeof stage.duration_ms === "number" ? stage.duration_ms : null,
    elapsed_ms: typeof stage.elapsed_ms === "number" ? stage.elapsed_ms : null,
    skipped: stage.skipped === true,
    reason: typeof stage.reason === "string" ? stage.reason : null,
    local: stage.local === true,
    count: stageCount(stage),
  };
}

export async function handleAsk(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sse = new Sse(res);
  const startedAt = Date.now();
  const timings: StageTiming[] = [];
  const state = {
    question: "",
    results: [] as RetrievalResult[],
    failure: null as AskFailure | null,
    logged: false,
    cited: [] as string[],
    confidence: null as number | null,
    abstain: true,
    errorText: null as string | null,
    answerText: null as string | null,
  };

  const sendTrace = async (): Promise<void> => {
    try {
      await recordAsk({
        question: state.question,
        timings,
        results: state.results,
        answerText: state.answerText,
        error: state.failure?.message ?? state.errorText,
        abstain: state.abstain,
        confidence: state.confidence,
        cited: state.cited,
      });
    } catch (err) {
      console.log(`[langfuse] ${err instanceof Error ? err.message : "trace failed"}`);
    }
  };

  /** One row per question, whatever happens to the rest of the pipeline. */
  const writeLog = async (): Promise<number | null> => {
    if (state.logged) return null;
    state.logged = true;
    const id = await insertQueryLog({
      question: scrubQuestion(state.question),
      stages: timings,
      citedCaseIds: state.cited,
      confidence: state.confidence,
      abstain: state.abstain,
      error: state.failure?.message ?? null,
    });
    if (id !== null) sse.write("log", { id });
    return id;
  };

  const fail = async (failure: AskFailure): Promise<void> => {
    state.failure = failure;
    sse.write("error", failure);
    await writeLog();
    sse.end();
  };

  try {
    const body = await readJsonBody(req);
    state.question = String(body?.question ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION);
    const k = Math.max(1, Math.min(20, Number(body?.k ?? 10) || 10));
    if (!state.question) {
      await fail({ message: "Type a question first.", stage: "ask", status: 422 });
      return;
    }

    await engineRetrieve(
      state.question,
      k,
      async (event) => {
        if (event.event === "stage") {
          const stage: StageEvent = { ...(event.data as StageEvent), local: false };
          stage.count = stageCount(stage);
          timings.push(toTiming(stage));
          sse.write("stage", stage);
        } else if (event.event === "result") {
          state.results = ((event.data?.results ?? []) as RetrievalResult[]) ?? [];
          sse.write("result", { results: state.results });
        } else if (event.event === "error") {
          const data = (event.data ?? {}) as Record<string, unknown>;
          state.failure = {
            message: String(data.message ?? data.error ?? data.detail ?? "The research service reported a failure."),
            stage: String(data.stage ?? "retrieve"),
            status: typeof data.status === "number" ? data.status : null,
          };
        }
      },
      AbortSignal.timeout(180000),
    );

    if (state.failure) {
      sse.write("error", state.failure);
      await writeLog();
      sse.end();
      return;
    }

    const localStage = (stage: string, extra: Partial<StageEvent> = {}): StageEvent => ({
      type: "stage",
      stage,
      duration_ms: null,
      elapsed_ms: Date.now() - startedAt,
      local: true,
      ...extra,
    });

    /* ---------- compose the answer from the returned passages, then validate */
    sse.write("stage", localStage("compose"));
    const composed = await composeAnswer(state.question, state.results);
    sse.write(
      "stage",
      localStage("compose", {
        duration_ms: composed.compose_ms,
        count: composed.answer.sentences.length,
        skipped: composed.answer.sentences.length === 0,
        reason: composed.writer_error,
        model: composed.model,
        dropped: composed.answer.dropped.length,
      }),
    );
    timings.push({
      stage: "compose",
      duration_ms: composed.compose_ms,
      elapsed_ms: Date.now() - startedAt,
      skipped: composed.answer.sentences.length === 0,
      reason: composed.writer_error,
      local: true,
      count: composed.answer.sentences.length,
    });

    /* ---------------------------------------------- check the surviving claims */
    const hasClaims = composed.claims.length > 0;
    sse.write("stage", localStage("check"));
    const checked = await runCheck(composed.claims, composed.answer);
    sse.write(
      "stage",
      localStage("check", {
        duration_ms: checked.ms,
        count: checked.answer.sentences.length,
        skipped: !hasClaims,
        reason: hasClaims ? (checked.answer.check_error ?? null) : "no verified sentence left to check",
        abstain: checked.answer.abstain,
      }),
    );
    timings.push({
      stage: "check",
      duration_ms: checked.ms,
      elapsed_ms: Date.now() - startedAt,
      skipped: !hasClaims,
      reason: hasClaims ? (checked.answer.check_error ?? null) : "no verified sentence left to check",
      local: true,
      count: checked.answer.sentences.length,
    });

    const answer = {
      ...checked.answer,
      writer_error: composed.writer_error,
      timings: { ...checked.answer.timings, total_ms: Date.now() - startedAt },
    };
    sse.write("answer", answer);

    state.cited = answer.cited_cases.map((c) => c.case.id);
    state.confidence = answer.answer_confidence;
    state.abstain = answer.abstain;
    state.errorText = answer.writer_error ?? answer.check_error;
    state.answerText = answer.text;
    await writeLog();
    sse.end();
  } catch (err) {
    const info = describeError(err);
    const status = err instanceof EngineError ? err.status : info.status;
    await fail({ message: info.message, stage: "pipeline", status });
  } finally {
    await sendTrace();
  }
}
