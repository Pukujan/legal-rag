import type { ReactNode } from "react";
import type { EngineSpan } from "@shared/types";

/**
 * Numbers are shown exactly as the API returned them — no rounding, no
 * re-scaling, no derived metric that the engine did not report.
 */
export function rawValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : String(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return `${value.length} items`;
  return "—";
}

export interface FlatField {
  key: string;
  value: string;
  /** Array length, when the field was a list. */
  items?: number;
}

/**
 * Flatten whatever the engine returned into `label: value` rows. Nested objects
 * become dotted keys; arrays of primitives are joined; arrays of objects are
 * counted and rendered separately by the caller.
 */
export function flattenFields(value: unknown, prefix = ""): FlatField[] {
  if (value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return [];
  const rows: FlatField[] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (raw === null || typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string") {
      rows.push({ key: path, value: rawValue(raw) });
    } else if (Array.isArray(raw)) {
      const primitives = raw.every((item) => item === null || typeof item !== "object");
      rows.push({
        key: path,
        value: primitives ? raw.map((item) => rawValue(item)).join(", ") : "",
        items: raw.length,
      });
    } else {
      rows.push(...flattenFields(raw, path));
    }
  }
  return rows;
}

/** Column names for a list of records, in first-seen order. */
export function columnsFromRows(rows: Array<Record<string, unknown>>): string[] {
  const keys: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row ?? {})) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

/** Turn any record value into something printable in a table cell. */
export function cellValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    if (Array.isArray(value)) {
      if (!value.length) return "—";
      if (value.every((item) => item === null || typeof item !== "object")) {
        return value.map((item) => rawValue(item)).join(", ");
      }
      return `${value.length} items`;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length <= 3 && entries.every(([, v]) => v === null || typeof v !== "object")) {
      return entries.map(([k, v]) => `${k}=${rawValue(v)}`).join(", ");
    }
    return `${entries.length} fields`;
  }
  return rawValue(value);
}

export interface HighlightRange {
  start: number;
  end: number;
  /** `cite` = cited span, `passage` = span the engine marked, `match` = search term. */
  tone: "cite" | "passage" | "match";
}

/** Merge overlapping ranges, preferring the strongest tone. */
function mergeRanges(ranges: HighlightRange[], length: number): HighlightRange[] {
  const toneRank = { match: 0, passage: 1, cite: 2 } as const;
  const clipped = ranges
    .filter((r) => r.end > r.start && r.start >= 0 && r.end <= length)
    .sort((a, b) => a.start - b.start || toneRank[b.tone] - toneRank[a.tone]);
  const out: HighlightRange[] = [];
  let cursor = 0;
  for (const range of clipped) {
    if (range.start < cursor) {
      if (range.end <= cursor) continue;
      out.push({ ...range, start: cursor });
      cursor = range.end;
      continue;
    }
    out.push(range);
    cursor = range.end;
  }
  return out;
}

/**
 * Render text with highlighted ranges. Used for the quoted span the answer
 * relied on and for any span the engine stored with the passage.
 */
export function highlightText(text: string, ranges: HighlightRange[]): ReactNode[] {
  const merged = mergeRanges(ranges, text.length);
  if (!merged.length) return [text];
  const nodes: ReactNode[] = [];
  let cursor = 0;
  merged.forEach((range, index) => {
    if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
    nodes.push(
      <mark
        key={`h${index}`}
        className={range.tone === "cite" ? "cite cite--gold" : "cite"}
        data-tone={range.tone}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

/** Every span the engine stored on a passage, plus the answer's own quote. */
export function rangesForPassage(text: string, spans: EngineSpan[] | undefined, quote?: string): HighlightRange[] {
  const ranges: HighlightRange[] = (spans ?? [])
    .filter((span) => typeof span?.start === "number" && typeof span?.end === "number")
    .map((span) => ({
      start: Math.max(0, Math.min(text.length, span.start)),
      end: Math.max(0, Math.min(text.length, span.end)),
      tone: "passage" as const,
    }));
  if (quote && quote.length) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(quote, from);
      if (at < 0) break;
      ranges.push({ start: at, end: at + quote.length, tone: "cite" });
      from = at + quote.length;
    }
  }
  return ranges;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
