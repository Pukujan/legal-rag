/** Text is the contract: every colour-coded state also has words. */

export type SupportState = "supported" | "unsupported" | "pending";

export function supportFor(accepted: boolean | null, prob: number | null): SupportState {
  if (accepted === true) return "supported";
  if (accepted === false) return "unsupported";
  if (prob !== null && !Number.isNaN(prob)) return prob >= 0.5 ? "supported" : "unsupported";
  return "pending";
}

export const SUPPORT_LABEL: Record<SupportState, string> = {
  supported: "Supported by the quoted passage",
  unsupported: "Not supported",
  pending: "Awaiting the checker",
};

export const SUPPORT_WORD: Record<SupportState, string> = {
  supported: "supported",
  unsupported: "not supported",
  pending: "pending",
};

export function ms(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10000 ? 2 : 1)} s`;
}

export function percent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export function score(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(3);
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date) + " UTC";
}

export function shortDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (
    new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date) +
    ", " +
    new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(date) +
    " UTC"
  );
}

/** The engine's stage names, in the order they normally run. */
export const STAGE_ORDER = [
  "parse",
  "bm25",
  "dense",
  "hybrid",
  "graph",
  "rerank",
  "jev",
  "compose",
  "check",
] as const;

export const STAGE_TITLE: Record<string, string> = {
  parse: "Read the question",
  bm25: "Word matches",
  dense: "Meaning matches",
  hybrid: "Combined shortlist",
  graph: "Citation graph",
  rerank: "Re-ranked by fit",
  jev: "Evidence check",
  compose: "Wrote the answer",
  check: "Checked the answer",
};

export const STAGE_PLAIN: Record<string, string> = {
  parse: "We read your question and picked out any case names or citations in it.",
  bm25: "We looked for the words of your question inside the stored opinions.",
  dense: "We looked for opinions that mean what your question means, even in different words.",
  hybrid: "We merged the word matches and the meaning matches into one shortlist.",
  graph: "We followed the citations between opinions to pick up anything the shortlist missed.",
  rerank: "We re-ordered the shortlist so the most useful opinions come first.",
  jev: "We checked whether the evidence in the passages actually answers the question.",
  compose: "We wrote the answer using only the passages we returned.",
  check: "We asked the checker whether each sentence is really supported by its quote.",
};

export function stageTitle(stage: string): string {
  return STAGE_TITLE[stage] ?? stage.replace(/-/g, " ");
}

export function stagePlain(stage: string): string {
  return STAGE_PLAIN[stage] ?? `The ${stage} step ran.`;
}

export function numberOrDash(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
}
