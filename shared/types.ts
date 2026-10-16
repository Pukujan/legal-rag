/** Types shared by the server pipeline and the browser. No runtime imports here. */

export interface EngineCaseRef {
  id: string;
  name: string;
  court: string;
  year: number | string;
  link?: string | null;
}

export interface EngineSpan {
  start: number;
  end: number;
  text: string;
}

export interface EnginePassage {
  chunk_id: string;
  text: string;
  spans?: EngineSpan[];
}

export interface RetrievalResult {
  rank: number;
  case: EngineCaseRef;
  score: number;
  score_kind: string;
  provenance: string[];
  passages: EnginePassage[];
}

/** Candidate lists inside stage payloads. */
export interface StageCandidate {
  doc_id: string;
  rank?: number;
  score?: number;
  ranks?: Record<string, number>;
  prev_rank?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: string;
}

export interface StageEvent {
  type: "stage";
  stage: string;
  duration_ms: number | null;
  elapsed_ms: number | null;
  skipped?: boolean;
  reason?: string | null;
  /** True while a step is still running (our own compose/verify steps). */
  running?: boolean;
  /** Added by the server: number of items the step reported. */
  count?: number | null;
  local?: boolean;
  citations?: string[];
  candidates?: StageCandidate[];
  edges?: GraphEdge[];
  added?: Array<{ doc_id: string; via?: string }>;
  [extra: string]: unknown;
}

export interface ClaimInput {
  text: string;
  cited_text: string;
  citation: string;
  chunk_id: string;
}

export interface ClaimCheck {
  claim_index: number;
  calibrated_prob: number | null;
  accepted: boolean | null;
}

export interface CheckResponse {
  claims: ClaimCheck[];
  answer_confidence: number | null;
  abstain: boolean;
  quotes: Array<{ quote_verified?: boolean; [k: string]: unknown }>;
}

export interface AnswerSentence {
  index: number;
  text: string;
  marker: number | null;
  case_id: string | null;
  case_name: string | null;
  quote: string;
  chunk_id: string;
  accepted: boolean | null;
  calibrated_prob: number | null;
}

export interface DroppedSentence {
  text: string;
  reason: string;
}

export interface CitedCase {
  rank: number;
  case: EngineCaseRef;
  score: number;
  score_kind: string;
  provenance: string[];
  spans: Array<{ chunk_id: string; text: string; start: number; end: number }>;
}

export interface FinalAnswer {
  question: string;
  text: string;
  sentences: AnswerSentence[];
  dropped: DroppedSentence[];
  cited_cases: CitedCase[];
  answer_confidence: number | null;
  abstain: boolean;
  checked: boolean;
  check_error: string | null;
  answer_source: "model" | "none";
  model: string | null;
  /** Whether each quote the checker looked at was found verbatim, in claim order. */
  quotes_verified?: boolean[];
  writer_error: string | null;
  timings: { compose_ms: number | null; check_ms: number | null; total_ms: number };
}

export interface AskFailure {
  message: string;
  stage: string;
  status: number | null;
}

export interface StageTiming {
  stage: string;
  duration_ms: number | null;
  elapsed_ms: number | null;
  skipped: boolean;
  reason: string | null;
  local: boolean;
  count: number | null;
}

export interface QueryLogRow {
  id: number;
  question: string;
  asked_at: string;
  stages: StageTiming[];
  cited_case_ids: string[];
  confidence: number | null;
  abstain: boolean;
  error: string | null;
}

export interface CaseDetail {
  case: EngineCaseRef & Record<string, unknown>;
  authority: unknown;
  passages: EnginePassage[];
}
