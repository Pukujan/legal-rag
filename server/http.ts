import type { IncomingMessage, ServerResponse } from "node:http";

export async function readJsonBody(req: IncomingMessage, limitBytes = 32 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limitBytes) throw new Error("Request body too large.");
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  return JSON.parse(text);
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

/** Minimal server-sent-events writer. The browser reads this with fetch + ReadableStream. */
export class Sse {
  private closed = false;

  constructor(private res: ServerResponse) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
  }

  write(event: string, data: unknown): void {
    if (this.closed) return;
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`);
  }

  comment(text: string): void {
    if (this.closed) return;
    this.res.write(`: ${text}\n\n`);
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.write("done", { type: "done" });
    this.res.end();
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

export function describeError(err: unknown): { message: string; status: number | null } {
  const anyErr = err as { message?: string; status?: number; name?: string };
  const message =
    typeof anyErr?.message === "string"
      ? anyErr.message
      : "Something went wrong in the research pipeline.";
  const status = typeof anyErr?.status === "number" ? anyErr.status : null;
  return { message, status };
}
