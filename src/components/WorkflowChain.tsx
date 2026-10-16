import { useState } from "react";
import type { StageEvent } from "@shared/types";
import { STAGE_ORDER, ms, stagePlain, stageTitle } from "@/lib/labels";
import { cn } from "@/lib/utils";

type Status = "waiting" | "running" | "done" | "skipped";

const STAGE_SHORT: Record<string, string> = {
  parse: "Question",
  bm25: "Words",
  dense: "Meaning",
  hybrid: "Shortlist",
  graph: "Graph",
  rerank: "Re-rank",
  jev: "Evidence",
  compose: "Answer",
  check: "Check",
};

function statusOf(stage: StageEvent): Status {
  if (stage.skipped) return "skipped";
  if (stage.running === true || stage.duration_ms === null || stage.duration_ms === undefined) return "running";
  return "done";
}

const STATUS_WORD: Record<Status, string> = {
  waiting: "waiting",
  running: "in progress",
  done: "done",
  skipped: "skipped",
};

const DOT_CLASS: Record<Status, string> = {
  waiting: "border-navy-600 bg-navy-900",
  running: "border-cyan bg-cyan/30 animate-pulse",
  done: "border-cyan bg-cyan",
  skipped: "border-bad bg-bad/25",
};

export interface WorkflowStage extends StageEvent {
  status: Status;
}

/** Order the raw stream the way the pipeline actually runs. */
export function orderStages(seen: StageEvent[]): WorkflowStage[] {
  const byName = new Map<string, StageEvent>();
  for (const stage of seen) byName.set(stage.stage, stage); // last event wins (running → finished)
  const known = STAGE_ORDER.filter((name) => byName.has(name)).map((name) => name as string);
  const extras = [...byName.keys()].filter((name) => !known.includes(name));
  return [...known, ...extras].map((name) => {
    const stage = byName.get(name)!;
    return { ...stage, status: statusOf(stage) };
  });
}

function detail(stage: WorkflowStage): string {
  if (stage.status === "skipped") {
    return stage.reason ? `Skipped — ${stage.reason}` : "Skipped by the engine.";
  }
  if (stage.status === "running") return "In progress…";
  const bits: string[] = [`took ${ms(stage.duration_ms)}`];
  if (typeof stage.count === "number") bits.push(`${stage.count} returned`);
  if (typeof stage.elapsed_ms === "number") bits.push(`${ms(stage.elapsed_ms)} from the start`);
  return bits.join(" · ");
}

function waitingRow(stage: string): WorkflowStage {
  return { stage, type: "stage", duration_ms: null, elapsed_ms: null, status: "waiting" };
}

interface Props {
  stages: WorkflowStage[];
  layout: "column" | "row";
  started: boolean;
  className?: string;
}

export default function WorkflowChain({ stages, layout, started, className = "" }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const planned = started && stages.length > 0;

  const rows: WorkflowStage[] = planned
    ? [
        ...stages,
        ...STAGE_ORDER.filter((name) => !stages.some((s) => s.stage === name)).map((name) =>
          waitingRow(String(name)),
        ),
      ]
    : stages;

  const running = rows.find((row) => row.status === "running");
  const doneCount = rows.filter((row) => row.status === "done").length;

  if (layout === "row") {
    return (
      <div className={cn("min-w-0", className)}>
        <ol className="flex items-center gap-1.5 overflow-x-auto pb-1" aria-label="Pipeline steps">
          {rows.map((row) => (
            <li key={row.stage} className="shrink-0">
              <button
                type="button"
                onClick={() => setOpen(open === row.stage ? null : row.stage)}
                aria-expanded={open === row.stage}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[0.68rem] font-medium tracking-wide",
                  row.status === "done" && "border-cyan/60 bg-cyan/10 text-cyan-soft",
                  row.status === "running" && "border-cyan bg-cyan/15 text-cyan-soft",
                  row.status === "skipped" && "border-bad/60 bg-bad/10 text-bad",
                  row.status === "waiting" && "border-navy-700 bg-navy-900 text-ink-mute",
                )}
              >
                {STAGE_SHORT[row.stage] ?? row.stage}
                <span className="sr-only"> — {STATUS_WORD[row.status]}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="mt-1.5 text-xs text-ink-dim" aria-live="polite">
          {rows.length ? `${doneCount} of ${rows.length} steps finished` : "Steps appear here as the search runs"}
          {running ? ` · now: ${stageTitle(running.stage)} (${detail(running)})` : ""}
        </p>
        {open ? (
          <p className="mt-1 text-xs text-ink-mute">
            {stageTitle(open)} — {stagePlain(open)}.{" "}
            {detail(rows.find((r) => r.stage === open) ?? waitingRow(open))}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <ol className={cn("space-y-1", className)} aria-label="How this answer was found">
      {rows.map((row) => {
        const isOpen = open === row.stage;
        return (
          <li key={row.stage} className="relative pl-6">
            <span
              aria-hidden="true"
              className={cn(
                "absolute top-0 h-full w-px",
                row.status === "waiting" ? "left-[0.55rem] bg-navy-700/40" : "left-[0.55rem] bg-navy-700",
              )}
            />
            <span
              aria-hidden="true"
              className={cn(
                "absolute left-1 top-[0.72rem] h-2.5 w-2.5 rounded-full border",
                DOT_CLASS[row.status],
              )}
            />
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : row.stage)}
              aria-expanded={isOpen}
              className="w-full rounded-md px-1 py-1 text-left transition-colors hover:bg-navy-800/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
            >
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={cn(
                    "text-sm",
                    row.status === "waiting" ? "text-ink-mute" : "text-ink",
                    row.status === "skipped" && "text-bad",
                  )}
                >
                  {stageTitle(row.stage)}
                </span>
                <span className="text-xs text-ink-mute">{STATUS_WORD[row.status]}</span>
                {row.status === "done" || row.status === "skipped" ? (
                  <span className="text-xs tabular-nums text-ink-mute">{detail(row)}</span>
                ) : null}
              </span>
              {isOpen ? (
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-dim">
                  {stagePlain(row.stage)}. {row.status === "waiting" ? "Not started yet." : detail(row)}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
