import type { IncomingMessage, ServerResponse } from "node:http";
import { engineGet } from "./engine";
import { sendJson } from "./http";
import { listQueryLog, dbStatus } from "./db";
import type { QueryLogRow, StageTiming } from "../shared/types";

/** Percentile for an unsorted list of millisecond timings. */
function percentile(values: number[], p: number): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil(p * clean.length) - 1));
  return clean[index];
}

function summarise(rows: QueryLogRow[]) {
  const byStage = new Map<string, StageTiming[]>();
  for (const row of rows) {
    for (const timing of row.stages) {
      if (timing.skipped) continue;
      const list = byStage.get(timing.stage) ?? [];
      list.push(timing);
      byStage.set(timing.stage, list);
    }
  }
  const stages = [...byStage.entries()].map(([stage, list]) => {
    const durations = list.map((s) => s.duration_ms).filter((v): v is number => typeof v === "number");
    return {
      stage,
      samples: durations.length,
      skipped_count: rows.filter((r) => r.stages.some((s) => s.stage === stage && s.skipped)).length,
      median_ms: percentile(durations, 0.5),
      p95_ms: percentile(durations, 0.95),
      max_ms: durations.length ? Math.max(...durations) : null,
      local: list[0]?.local === true,
    };
  });

  const confidences = rows.map((r) => r.confidence).filter((v): v is number => typeof v === "number");
  const answers = rows.filter((r) => r.cited_case_ids.length > 0).length;
  const errors = rows.filter((r) => r.error).length;
  const abstentions = rows.filter((r) => r.abstain).length;
  const hours = new Map<string, number>();
  for (const row of rows) {
    const key = row.asked_at.slice(0, 13);
    if (key.length === 13) hours.set(`${key}:00`, (hours.get(`${key}:00`) ?? 0) + 1);
  }

  return {
    questions: rows.length,
    answers,
    abstentions,
    errors,
    confidence: {
      samples: confidences.length,
      median: percentile(confidences, 0.5),
      p95: percentile(confidences, 0.95),
      min: confidences.length ? Math.min(...confidences) : null,
      max: confidences.length ? Math.max(...confidences) : null,
    },
    stages,
    per_hour: [...hours.entries()].map(([hour, count]) => ({ hour, count })).sort(),
  };
}

export async function handleQueryLog(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/query-log", "http://local");
  const limit = Number(url.searchParams.get("limit") ?? 200);
  const status = dbStatus();
  if (!status.configured) {
    sendJson(res, 503, { rows: [], summary: null, configured: false, reason: status.reason });
    return;
  }
  try {
    const rows = await listQueryLog(limit);
    sendJson(res, 200, { rows, summary: summarise(rows), configured: true, reason: null });
  } catch (err) {
    sendJson(res, 500, {
      rows: [],
      summary: null,
      configured: false,
      reason: (err as Error).message || "The query log could not be read.",
    });
  }
}

export async function handleHealth(res: ServerResponse): Promise<void> {
  try {
    const health = await engineGet("/api/v1/health", false);
    sendJson(res, 200, { ok: true, health, database: dbStatus() });
  } catch (err) {
    sendJson(res, 200, {
      ok: false,
      health: null,
      error: (err as Error).message,
      database: dbStatus(),
    });
  }
}

function blank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** Court, year, link and cap id live on the authority row and the chunk id when the work row is empty. */
function fillCase(detail: Record<string, unknown>): Record<string, unknown> {
  const raw = detail.case && typeof detail.case === "object" ? (detail.case as Record<string, unknown>) : {};
  const auth =
    detail.authority && typeof detail.authority === "object" ? (detail.authority as Record<string, unknown>) : {};
  const caseObj: Record<string, unknown> = { ...raw };
  if (blank(caseObj.court) && typeof auth.court === "string") caseObj.court = auth.court;
  if (blank(caseObj.year) && typeof auth.date === "string") {
    const year = Number(auth.date.slice(0, 4));
    if (Number.isInteger(year)) caseObj.year = year;
  }
  if (blank(caseObj.link) && typeof auth.url === "string" && /^https?:\/\//.test(auth.url)) caseObj.link = auth.url;
  if (blank(caseObj.cap_id) && Array.isArray(detail.passages)) {
    for (const passage of detail.passages) {
      const chunkId = String((passage as { chunk_id?: unknown })?.chunk_id ?? "");
      const match = /^cap:(\d+):/.exec(chunkId);
      if (match) {
        caseObj.cap_id = match[1];
        break;
      }
    }
  }
  if ((blank(caseObj.name) || caseObj.name === caseObj.id) && typeof auth.title === "string" && auth.title) {
    caseObj.name = auth.title;
  }
  return { ...detail, case: caseObj };
}

export async function handleCaseDetail(id: string, res: ServerResponse): Promise<void> {
  try {
    const detail = await engineGet(`/api/v1/cases/${encodeURIComponent(id)}`);
    sendJson(res, 200, fillCase((detail ?? {}) as Record<string, unknown>));
  } catch (err) {
    const e = err as { message?: string; status?: number };
    // Cloudflare replaces an origin 502 body with its own page, so the
    // browser would only see "HTTP 502". 422 keeps this JSON message.
    sendJson(res, 422, { error: e.message ?? "Case not found." });
  }
}

export async function handleBenchmarks(res: ServerResponse): Promise<void> {
  try {
    sendJson(res, 200, await engineGet("/api/v1/benchmarks"));
  } catch (err) {
    sendJson(res, 422, { runs: [], error: (err as Error).message });
  }
}

export async function handleBenchmarkRun(runId: string, res: ServerResponse): Promise<void> {
  try {
    sendJson(res, 200, await engineGet(`/api/v1/benchmarks/${encodeURIComponent(runId)}`));
  } catch (err) {
    sendJson(res, 422, { error: (err as Error).message });
  }
}
