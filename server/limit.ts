/**
 * Gates the public research API.
 * Searches: 20 per browser per 10 minutes, 40 per address per 10 minutes,
 * 40 per minute for everyone, with 2 running at once and 8 waiting.
 * Opinion reads: 30 per browser per 10 minutes, 60 per address per 10 minutes,
 * 60 per minute for everyone.
 */

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const SESSION_ASKS = 20;
const SESSION_ASK_WINDOW_MS = 10 * 60 * 1000;
const IP_ASKS = 40;
const IP_ASK_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_ASKS = 40;
const GLOBAL_ASK_WINDOW_MS = 60 * 1000;

const SESSION_CASES = 30;
const SESSION_CASE_WINDOW_MS = 10 * 60 * 1000;
const IP_CASES = 60;
const IP_CASE_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_CASES = 60;
const GLOBAL_CASE_WINDOW_MS = 60 * 1000;

const MAX_CONCURRENT = 2;
const MAX_WAITING = 8;
const QUEUE_WAIT_MS = 25_000;

class Window {
  private stamps: number[] = [];

  allow(now: number, windowMs: number, max: number): boolean {
    const floor = now - windowMs;
    this.stamps = this.stamps.filter((stamp) => stamp > floor);
    if (this.stamps.length >= max) return false;
    this.stamps.push(now);
    return true;
  }
}

class Gate {
  private buckets = new Map<string, Window>();

  allow(key: string, now: number, windowMs: number, max: number): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      if (this.buckets.size > 4000) {
        const oldest = this.buckets.keys().next().value;
        if (oldest) this.buckets.delete(oldest);
      }
      bucket = new Window();
      this.buckets.set(key, bucket);
    }
    return bucket.allow(now, windowMs, max);
  }
}

const asks = new Gate();
const cases = new Gate();

let running = 0;
const waiters: Array<() => void> = [];

export type Admit =
  | { ok: true; release: () => void }
  | { ok: false; error: string; retryAfter: number };

function sessionId(req: IncomingMessage, res: ServerResponse): string {
  const raw = req.headers.cookie ?? "";
  const match = /(?:^|;\s*)lg_sid=([a-f0-9]{32})/.exec(raw);
  if (match) return match[1];
  const id = randomBytes(16).toString("hex");
  const cookie = `lg_sid=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
  const prev = res.getHeader("Set-Cookie");
  if (!prev) res.setHeader("Set-Cookie", cookie);
  else if (Array.isArray(prev)) res.setHeader("Set-Cookie", [...prev, cookie]);
  else res.setHeader("Set-Cookie", [String(prev), cookie]);
  return id;
}

function clientIp(req: IncomingMessage): string | null {
  const header = req.headers["cf-connecting-ip"];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") return null;
  const ip = value.trim();
  return ip ? ip.slice(0, 64) : null;
}

function releaseSlot(): void {
  running = Math.max(0, running - 1);
  const next = waiters.shift();
  if (next) next();
}

function acquireSlot(): Promise<() => void> {
  if (running < MAX_CONCURRENT) {
    running += 1;
    return Promise.resolve(releaseSlot);
  }
  if (waiters.length >= MAX_WAITING) {
    return Promise.reject(new Error("The research queue is full. Wait a moment and try again."));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const index = waiters.indexOf(start);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error("The research queue did not reach your question in time. Try again."));
    }, QUEUE_WAIT_MS);
    const start = () => {
      clearTimeout(timer);
      running += 1;
      resolve(releaseSlot);
    };
    waiters.push(start);
  });
}

export async function admitAsk(req: IncomingMessage, res: ServerResponse): Promise<Admit> {
  const now = Date.now();
  const session = sessionId(req, res);
  const ip = clientIp(req);
  if (!asks.allow(`s:${session}`, now, SESSION_ASK_WINDOW_MS, SESSION_ASKS)) {
    return {
      ok: false,
      retryAfter: 60,
      error: "This browser has used its 20 searches for this 10 minutes. Wait and try again.",
    };
  }
  if (ip && !asks.allow(`i:${ip}`, now, IP_ASK_WINDOW_MS, IP_ASKS)) {
    return {
      ok: false,
      retryAfter: 60,
      error: "This address has used its 40 searches for this 10 minutes. Wait and try again.",
    };
  }
  if (!asks.allow("global", now, GLOBAL_ASK_WINDOW_MS, GLOBAL_ASKS)) {
    return {
      ok: false,
      retryAfter: 20,
      error: "The shared search limit is full for this minute. Wait and try again.",
    };
  }
  try {
    const release = await acquireSlot();
    return { ok: true, release };
  } catch (err) {
    return { ok: false, retryAfter: 15, error: (err as Error).message };
  }
}

export function admitCase(req: IncomingMessage, res: ServerResponse): Admit {
  const now = Date.now();
  const session = sessionId(req, res);
  const ip = clientIp(req);
  if (!cases.allow(`s:${session}`, now, SESSION_CASE_WINDOW_MS, SESSION_CASES)) {
    return {
      ok: false,
      retryAfter: 30,
      error: "This browser has opened enough opinions for this 10 minutes. Wait and try again.",
    };
  }
  if (ip && !cases.allow(`i:${ip}`, now, IP_CASE_WINDOW_MS, IP_CASES)) {
    return {
      ok: false,
      retryAfter: 30,
      error: "This address has opened enough opinions for this 10 minutes. Wait and try again.",
    };
  }
  if (!cases.allow("global", now, GLOBAL_CASE_WINDOW_MS, GLOBAL_CASES)) {
    return {
      ok: false,
      retryAfter: 15,
      error: "The shared opinion limit is full for this minute. Wait and try again.",
    };
  }
  return { ok: true, release: () => undefined };
}
