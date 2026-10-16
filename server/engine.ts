import { engine } from "./config";

export type EngineEvent = { event: string; data: any };

export class EngineError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status = 0, detail: unknown = null) {
    super(message);
    this.name = "EngineError";
    this.status = status;
    this.detail = detail;
  }
}

/** Copy an engine HTTP status into language a researcher can act on. */
export function engineErrorMessage(status: number, detail?: any): string {
  if (status === 401) return "The research service rejected our key (HTTP 401). Nothing was searched.";
  if (status === 422) return "The research service did not accept that question (HTTP 422).";
  if (status === 503) {
    const why = detail?.error ?? detail?.detail ?? detail?.reason;
    return typeof why === "string" && why
      ? `The research service is not ready yet: ${why}`
      : "The research service is still loading its collection (HTTP 503). Try again in a moment.";
  }
  if (!engine.configured()) return "The research service is not configured on this server.";
  return `The research service failed (HTTP ${status || 0}).`;
}

async function readError(res: Response): Promise<EngineError> {
  let detail: any = null;
  try {
    detail = await res.json();
  } catch {
    try {
      detail = (await res.text()).slice(0, 400);
    } catch {
      detail = null;
    }
  }
  const raw = detail?.error ?? detail?.detail ?? detail?.message ?? detail;
  const message =
    typeof raw === "string" && raw.trim()
      ? raw.trim()
      : engineErrorMessage(res.status, detail);
  return new EngineError(message || engineErrorMessage(res.status, detail), res.status, detail);
}

function authHeaders(withToken: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (withToken && engine.token()) headers.Authorization = `Bearer ${engine.token()}`;
  return headers;
}

/** GET a JSON endpoint on the engine. `auth: false` for /api/v1/health. */
export async function engineGet(path: string, auth = true): Promise<any> {
  if (!engine.configured()) throw new EngineError(engineErrorMessage(0), 0);
  const res = await fetch(engine.baseUrl() + path, { headers: authHeaders(auth) });
  if (!res.ok) throw await readError(res);
  return res.json();
}

export async function enginePost(path: string, body: unknown): Promise<any> {
  if (!engine.configured()) throw new EngineError(engineErrorMessage(0), 0);
  const res = await fetch(engine.baseUrl() + path, {
    method: "POST",
    headers: { ...authHeaders(true), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

/**
 * POST /api/v1/retrieve and hand back each server-sent event as it arrives.
 * Resolves once the stream ends; throws EngineError on an HTTP or `error` event.
 */
export async function engineRetrieve(
  query: string,
  k: number,
  onEvent: (event: EngineEvent) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!engine.configured()) throw new EngineError(engineErrorMessage(0), 0);
  const res = await fetch(engine.baseUrl() + "/api/v1/retrieve", {
    method: "POST",
    signal,
    headers: {
      ...authHeaders(true),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({ query, k }),
  });
  if (!res.ok) throw await readError(res);
  if (!res.body) throw new EngineError("The research service returned an empty stream.", res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const flush = async (block: string) => {
    const parsed = parseBlock(block);
    if (!parsed) return;
    if (parsed.event === "error") {
      const detail = parsed.data;
      const message =
        detail?.message ?? detail?.error ?? detail?.detail ?? "The research service reported a failure.";
      throw new EngineError(String(message), 0, detail);
    }
    await onEvent(parsed);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = findBoundary(buffer)) >= 0) {
      const block = buffer.slice(0, nl);
      buffer = buffer.slice(nl).replace(/^\r?\n\r?\n/, "");
      await flush(block);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) await flush(buffer);
}

function findBoundary(text: string): number {
  const a = text.indexOf("\n\n");
  const b = text.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function parseBlock(block: string): EngineEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (!dataLines.length) return event === "message" ? null : { event, data: null };
  const raw = dataLines.join("\n");
  let data: any = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    /* keep the raw payload if the engine sent non-JSON data */
  }
  return { event, data };
}
