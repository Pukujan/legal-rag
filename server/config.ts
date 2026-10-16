/**
 * Server-only configuration. Nothing in this file (or anything that imports it)
 * is ever shipped to the browser: it is reached only through the /api/* routes
 * registered by server/plugin.ts.
 */

function clean(url: string | undefined, fallback = ""): string {
  const value = (url ?? fallback).trim();
  return value.replace(/\/+$/, "");
}

export const engine = {
  baseUrl: () => clean(process.env.ENGINE_BASE_URL),
  token: () => (process.env.ENGINE_API_TOKEN ?? "").trim(),
  configured: () => clean(process.env.ENGINE_BASE_URL).length > 0,
};

export const ollama = {
  baseUrl: () => clean(process.env.OLLAMA_BASE_URL, "http://127.0.0.1:11434"),
  model: () => (process.env.OLLAMA_MODEL ?? "").trim(),
  timeoutMs: () => Number(process.env.OLLAMA_TIMEOUT_MS ?? 90000),
};

/**
 * Zero-price catalog ids from the OpenRouter models API.
 * These are specific models. `openrouter/free` is a router and is not used.
 */
export const FREE_WRITER_MODELS = [
  "cohere/north-mini-code:free",
  "liquid/lfm-2.5-2.6b:free",
  "nvidia/nemotron-3.5-lightning:free",
] as const;

export const FREE_CHECKER_MODELS = [
  "nvidia/nemotron-3.5-lightning:free",
  "cohere/north-mini-code:free",
  "liquid/lfm-2.5-2.6b:free",
] as const;

export const openrouter = {
  apiKey: () => (process.env.OPENROUTER_API_KEY ?? "").trim(),
  configured: () => (process.env.OPENROUTER_API_KEY ?? "").trim().length > 0,
  writerModel: () => FREE_WRITER_MODELS[0],
  checkerModel: () => FREE_CHECKER_MODELS[0],
};

export const octo = {
  baseUrl: () => clean(process.env.OCTO_BASE_URL),
  workspaceId: () => (process.env.OCTO_WORKSPACE_ID ?? "").trim(),
  apiKey: () => (process.env.OCTO_API_KEY ?? "").trim(),
  configured: () =>
    clean(process.env.OCTO_BASE_URL).length > 0 &&
    (process.env.OCTO_WORKSPACE_ID ?? "").trim().length > 0 &&
    (process.env.OCTO_API_KEY ?? "").trim().length > 0,
};

/** Application schema — derived from the app name, never `public`. */
export const DB_SCHEMA = "aba_legal_research";

let logged = false;
/** Prints which integrations are reachable. Never prints secrets. */
export function logBoot(): void {
  if (logged) return;
  logged = true;
  console.log(
    `[api] engine=${engine.configured() ? engine.baseUrl() : "NOT CONFIGURED"} ` +
      `engineToken=${engine.token() ? "present" : "missing"} ` +
      `ollama=${ollama.baseUrl()} ollamaModel=${ollama.model() || "(auto)"} ` +
      `openrouter=${openrouter.configured() ? "present" : "missing"} ` +
      `writer=${openrouter.writerModel()} checker=${openrouter.checkerModel()} ` +
      `octo=${octo.configured() ? "present" : "NOT CONFIGURED"}`,
  );
}
