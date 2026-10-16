import type { RetrievalResult, StageEvent } from "@shared/types";

/** Why a point of light is lit the colour it is. */
export type HitKind = "keyword" | "meaning" | "both" | "traced" | "pending";

export const HIT_WORD: Record<HitKind, string> = {
  keyword: "word match",
  meaning: "meaning match",
  both: "word and meaning match",
  traced: "found by citation",
  pending: "candidate",
};

export const HIT_COLOUR: Record<HitKind, string> = {
  keyword: "#f7eeda", // warm white
  meaning: "#4fd6e8", // cyan
  both: "#e8c06a", // gold
  traced: "#9fe8f2",
  pending: "#8f9cba",
};

export interface CaseNode {
  id: string;
  name: string;
  court: string;
  year: string;
  link: string | null;
  kind: HitKind;
  rank: number | null;
  prevRank: number | null;
  score: number | null;
  scoreKind: string | null;
  cited: boolean;
  via: string | null;
  appearedAt: number;
  /** Stable unit position derived from the id. */
  u: number;
  v: number;
}

export interface SceneEdge {
  source: string;
  target: string;
  kind: string;
  appearedAt: number;
}

export interface SceneSummary {
  total: number;
  keyword: number;
  meaning: number;
  both: number;
  traced: number;
  edges: number;
  ranked: number;
  cited: number;
  topLabel: string | null;
  topRank: number | null;
}

function hash32(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Same id, same patch of sky, on every visit and on every page. */
export function hashUnit(id: string): [number, number] {
  const a = hash32(`x|${id}`) / 4294967295;
  const b = hash32(`y|${id}`) / 4294967295;
  return [0.07 + a * 0.86, 0.12 + b * 0.78];
}

const KEYWORD_KEY = /bm25|keyword|lexical|sparse|term/i;
const MEANING_KEY = /dense|vector|embed|nn|semantic|knn/i;

function kindFromRanks(ranks?: Record<string, number>): HitKind | null {
  if (!ranks) return null;
  const keys = Object.keys(ranks);
  const keyword = keys.some((k) => KEYWORD_KEY.test(k));
  const meaning = keys.some((k) => MEANING_KEY.test(k));
  if (keyword && meaning) return "both";
  if (keyword) return "keyword";
  if (meaning) return "meaning";
  return null;
}

/** Combine two reasons for lighting the same point. */
function mergeKind(existing: HitKind, next: HitKind): HitKind {
  if (existing === next) return existing;
  if (existing === "pending") return next;
  if (next === "pending" || next === "traced") return existing;
  const pair = `${existing}+${next}`;
  if (pair === "keyword+meaning" || pair === "meaning+keyword") return "both";
  if (existing === "both") return "both";
  return next === "both" ? "both" : existing;
}

const MAX_NODES = 64;

/**
 * The star field's data. Every visual state in here is derived from an engine
 * stage or result payload, and every one of them is also readable as text
 * through `summary()` and the case list on the Ask page.
 */
export class SceneGraph {
  readonly nodes = new Map<string, CaseNode>();
  edges: SceneEdge[] = [];
  /** Bumped on every change so the canvas knows when to redraw. */
  version = 0;
  citations: string[] = [];

  reset(): void {
    this.nodes.clear();
    this.edges = [];
    this.citations = [];
    this.version += 1;
  }

  private touch(): void {
    this.version += 1;
  }

  private node(id: string, now: number): CaseNode | null {
    if (!id) return null;
    const existing = this.nodes.get(id);
    if (existing) return existing;
    if (this.nodes.size >= MAX_NODES) return null;
    const [u, v] = hashUnit(id);
    const created: CaseNode = {
      id,
      name: id,
      court: "",
      year: "",
      link: null,
      kind: "pending",
      rank: null,
      prevRank: null,
      score: null,
      scoreKind: null,
      cited: false,
      via: null,
      appearedAt: now,
      u,
      v,
    };
    this.nodes.set(id, created);
    return created;
  }

  /** `now` is the canvas frame clock. Date.now() never lines up with it, so every point stays invisible. */
  applyStage(stage: StageEvent, now = performance.now()): void {
    if (stage.skipped) {
      this.touch();
      return;
    }
    if (stage.stage === "parse") {
      if (Array.isArray(stage.citations)) this.citations = stage.citations.map(String);
      this.touch();
      return;
    }

    if (Array.isArray(stage.candidates)) {
      const defaultKind: HitKind | null =
        stage.stage === "bm25"
          ? "keyword"
          : stage.stage === "dense"
            ? "meaning"
            : stage.stage === "hybrid"
              ? null
              : "pending";
      for (const candidate of stage.candidates) {
        const node = this.node(String(candidate.doc_id ?? ""), now);
        if (!node) continue;
        const kind = kindFromRanks(candidate.ranks) ?? defaultKind;
        if (kind) node.kind = mergeKind(node.kind, kind);
        if (typeof candidate.score === "number") node.score = candidate.score;
        if (stage.stage === "rerank" || stage.stage === "hybrid" || stage.stage === "bm25" || stage.stage === "dense") {
          if (typeof candidate.rank === "number") node.rank = candidate.rank;
        }
        if (typeof candidate.prev_rank === "number") node.prevRank = candidate.prev_rank;
      }
      this.touch();
    }

    if (stage.stage === "graph") {
      if (Array.isArray(stage.edges)) {
        for (const edge of stage.edges) {
          const source = String(edge?.source ?? "");
          const target = String(edge?.target ?? "");
          const kind = String(edge?.kind ?? "cites");
          if (!source || !target) continue;
          const key = `${source}|${target}|${kind}`;
          if (this.edges.some((e) => `${e.source}|${e.target}|${e.kind}` === key)) continue;
          // Only draw a line when both ends can be shown.
          if (!this.nodes.has(source) && !this.nodes.has(target)) continue;
          this.node(source, now);
          this.node(target, now);
          this.edges.push({ source, target, kind, appearedAt: now });
        }
      }
      if (Array.isArray(stage.added)) {
        for (const added of stage.added) {
          const node = this.node(String(added?.doc_id ?? ""), now);
          if (!node) continue;
          node.kind = node.kind === "pending" ? "traced" : node.kind;
          node.via = added?.via ? String(added.via) : "citation graph";
        }
      }
      this.touch();
    }
  }

  applyResults(results: RetrievalResult[], now = performance.now()): void {
    for (const result of results) {
      const node = this.node(String(result.case?.id ?? ""), now);
      if (!node) continue;
      node.name = result.case.name || node.name;
      node.court = result.case.court || "";
      node.year = String(result.case.year ?? "");
      node.link = result.case.link ?? null;
      node.rank = result.rank;
      node.score = typeof result.score === "number" ? result.score : node.score;
      node.scoreKind = result.score_kind ?? null;
      if (node.kind === "pending") node.kind = "pending";
    }
    this.touch();
  }

  markCited(ids: string[]): void {
    for (const node of this.nodes.values()) node.cited = false;
    for (const id of ids) {
      const node = this.nodes.get(String(id));
      if (node) node.cited = true;
    }
    this.touch();
  }

  ranked(): CaseNode[] {
    return [...this.nodes.values()]
      .filter((n) => n.rank !== null)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  }

  byId(id: string): CaseNode | undefined {
    return this.nodes.get(id);
  }

  summary(): SceneSummary {
    const counts: Record<HitKind, number> = {
      keyword: 0,
      meaning: 0,
      both: 0,
      traced: 0,
      pending: 0,
    };
    let cited = 0;
    let ranked = 0;
    for (const node of this.nodes.values()) {
      counts[node.kind] += 1;
      if (node.cited) cited += 1;
      if (node.rank !== null) ranked += 1;
    }
    const top = this.ranked()[0] ?? null;
    return {
      total: this.nodes.size,
      keyword: counts.keyword,
      meaning: counts.meaning,
      both: counts.both,
      traced: counts.traced,
      edges: this.edges.length,
      ranked,
      cited,
      topLabel: top ? top.name : null,
      topRank: top ? top.rank : null,
    };
  }
}
