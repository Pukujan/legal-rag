import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { logBoot } from "./config";
import { sendJson } from "./http";
import { handleAsk } from "./ask";
import { admitAsk, admitCase } from "./limit";
import { handleBenchmarkRun, handleBenchmarks, handleCaseDetail, handleHealth, handleQueryLog } from "./routes";

logBoot();

/**
 * Server-only API. The engine bearer token, the local model endpoint and the
 * application database credentials live in this process and are never sent to
 * the browser: the client can only reach the shapes defined below.
 */
function caseIdFrom(segments: string[]): string {
  return segments
    .slice(1)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join("/");
}

function rejectLimited(res: ServerResponse, error: string, retryAfter: number): void {
  res.setHeader("Retry-After", String(retryAfter));
  sendJson(res, 429, { error });
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://local");
  const path = url.pathname;
  if (!path.startsWith("/api/")) return false;
  const segments = path.split("/").filter(Boolean).slice(1);
  const method = (req.method ?? "GET").toUpperCase();

  try {
    if (segments[0] === "ask") {
      if (method !== "POST") {
        sendJson(res, 405, { error: "POST only." });
        return true;
      }
      const admission = await admitAsk(req, res);
      if (!admission.ok) {
        rejectLimited(res, admission.error, admission.retryAfter);
        return true;
      }
      try {
        await handleAsk(req, res);
      } finally {
        admission.release();
      }
      return true;
    }
    if (segments[0] === "health" && method === "GET") {
      await handleHealth(res);
      return true;
    }
    if (segments[0] === "query-log" && method === "GET") {
      await handleQueryLog(req, res);
      return true;
    }
    if (segments[0] === "cases" && method === "GET") {
      const id = caseIdFrom(segments);
      if (!id) {
        sendJson(res, 404, { error: "Case id missing." });
        return true;
      }
      const admission = admitCase(req, res);
      if (!admission.ok) {
        rejectLimited(res, admission.error, admission.retryAfter);
        return true;
      }
      await handleCaseDetail(id, res);
      return true;
    }
    if (segments[0] === "benchmarks") {
      if (method !== "GET") {
        sendJson(res, 405, { error: "GET only." });
        return true;
      }
      if (segments[1]) await handleBenchmarkRun(segments[1], res);
      else await handleBenchmarks(res);
      return true;
    }
    sendJson(res, 404, { error: `Unknown endpoint ${path}` });
  } catch (err) {
    console.error("[api] unhandled error:", err);
    if (!res.headersSent) sendJson(res, 500, { error: (err as Error).message || "Server error." });
    else res.end();
  }
  return true;
}

function attach(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((req, res, next) => {
    void route(req, res).then((handled) => {
      if (!handled) next();
    });
  });
}

export function apiPlugin(): Plugin {
  return {
    name: "aba-case-law-api",
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}
