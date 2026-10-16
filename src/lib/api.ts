import type {
  CaseDetail,
  FinalAnswer,
  QueryLogRow,
  RetrievalResult,
  StageEvent,
  StageTiming,
} from "@shared/types";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`The server returned something we could not read (HTTP ${res.status}).`);
  }
  if (!res.ok) {
    const message = (data as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export interface HealthResponse {
  ok: boolean;
  health: {
    status?: string;
    graph?: Record<string, unknown>;
    engine?: { status?: string; [k: string]: unknown };
  } | null;
  error?: string | null;
  database?: { configured: boolean; reason: string | null };
}

export const api = {
  health: () => get<HealthResponse>("/api/health"),
  caseDetail: (id: string) => get<CaseDetail>(`/api/cases/${encodeURIComponent(id)}`),
  benchmarks: () => get<{ runs?: unknown[]; error?: string | null }>("/api/benchmarks"),
  benchmarkRun: (runId: string) =>
    get<Record<string, unknown>>(`/api/benchmarks/${encodeURIComponent(runId)}`),
  queryLog: () =>
    get<{
      rows: QueryLogRow[];
      configured: boolean;
      reason: string | null;
      summary: {
        questions: number;
        answers: number;
        abstentions: number;
        errors: number;
        confidence: { samples: number; median: number | null; p95: number | null };
        stages: Array<{
          stage: string;
          samples: number;
          skipped_count: number;
          median_ms: number | null;
          p95_ms: number | null;
          local: boolean;
        }>;
        per_hour: Array<{ hour: string; count: number }>;
      } | null;
    }>("/api/query-log?limit=200"),
};

export interface AskStreamHandlers {
  onStage: (stage: StageEvent) => void;
  onResult: (results: RetrievalResult[]) => void;
  onAnswer: (answer: FinalAnswer) => void;
  onLog: (id: number) => void;
  onError: (error: { message: string; stage: string; status: number | null }) => void;
  onDone: () => void;
}

/**
 * POST /api/ask and read the reply as server-sent events. EventSource cannot
 * POST, so we read the stream by hand.
 */
export function askStream(question: string, handlers: AskStreamHandlers): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ question, k: 10 }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        let message = text || `The server answered HTTP ${res.status}.`;
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed?.error === "string" && parsed.error) message = parsed.error;
        } catch {
          /* The body was not JSON. */
        }
        handlers.onError({
          message,
          stage: "ask",
          status: res.status,
        });
        handlers.onDone();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      const handle = (block: string) => {
        let event = "message";
        const dataLines: string[] = [];
        for (const line of block.split(/\r?\n/)) {
          if (!line || line.startsWith(":")) continue;
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
        }
        if (!dataLines.length) return;
        let data: any = null;
        try {
          data = JSON.parse(dataLines.join("\n"));
        } catch {
          return;
        }
        switch (event) {
          case "stage":
            handlers.onStage(data as StageEvent);
            break;
          case "result":
            handlers.onResult((data?.results ?? []) as RetrievalResult[]);
            break;
          case "answer":
            handlers.onAnswer(data as FinalAnswer);
            break;
          case "log":
            if (typeof data?.id === "number") handlers.onLog(data.id);
            break;
          case "error":
            handlers.onError({
              message: String(data?.message ?? "The search failed."),
              stage: String(data?.stage ?? "ask"),
              status: typeof data?.status === "number" ? data.status : null,
            });
            break;
          case "done":
            handlers.onDone();
            break;
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          handle(block);
        }
      }
      if (buffer.trim()) handle(buffer);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        handlers.onError({ message: (err as Error).message, stage: "ask", status: null });
      }
    }
  })();

  return () => controller.abort();
}

export function stageSummary(stages: StageEvent[]): StageTiming[] {
  return stages.map((s) => ({
    stage: s.stage,
    duration_ms: typeof s.duration_ms === "number" ? s.duration_ms : null,
    elapsed_ms: typeof s.elapsed_ms === "number" ? s.elapsed_ms : null,
    skipped: s.skipped === true,
    reason: typeof s.reason === "string" ? s.reason : null,
    local: s.local === true,
    count: typeof s.count === "number" ? s.count : null,
  }));
}
