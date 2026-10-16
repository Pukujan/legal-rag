import { useEffect, useMemo, useState } from "react";
import type { QueryLogRow } from "@shared/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { dateTime, ms, numberOrDash, percent } from "@/lib/labels";
import { cellValue, columnsFromRows, flattenFields, rawValue } from "@/lib/render";
import { cn } from "@/lib/utils";

interface Run {
  id: string;
  label: string;
  payload: Record<string, unknown>;
}

const ROW_KEYS = ["per_query", "queries", "results", "rows", "cases", "examples"];

function asRecords(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function pickRun(value: unknown, index: number): Run | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id =
    typeof record.run_id === "string"
      ? record.run_id
      : typeof record.id === "string"
        ? record.id
        : typeof record.benchmark_run === "string"
          ? record.benchmark_run
          : `run-${index + 1}`;
  const label =
    typeof record.label === "string"
      ? record.label
      : typeof record.name === "string"
        ? record.name
        : typeof record.dataset === "string"
          ? record.dataset
          : id;
  return { id, label, payload: record };
}

function findRows(payload: Record<string, unknown>): { key: string; rows: Array<Record<string, unknown>> } | null {
  for (const key of ROW_KEYS) {
    const rows = asRecords(payload[key]);
    if (rows.length) return { key, rows };
  }
  for (const [key, value] of Object.entries(payload)) {
    const rows = asRecords(value);
    if (rows.length) return { key, rows };
  }
  return null;
}

/** Look for a flag the engine itself set on each row — do not invent one. */
function findOutcomeFlag(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return null;
  const preferred = ["win", "won", "hit", "top1_hit", "topk_hit", "success", "successful", "correct", "accepted", "pass", "passed"];
  const keys = columnsFromRows(rows);
  const ordered = [...preferred.filter((k) => keys.includes(k)), ...keys];
  for (const key of ordered) {
    const values = rows.map((row) => row[key]);
    const truthy = values.filter(
      (value) => typeof value === "boolean" || value === 1 || value === 0 || value === "true" || value === "false",
    );
    if (truthy.length === rows.length && truthy.length > 0) {
      const isWin = (value: unknown) =>
        value === true || value === 1 || value === "true";
      return { key, isWin };
    }
    // Nested flag, e.g. { top1: { hit: true } }
    if (values.every((value) => value && typeof value === "object" && !Array.isArray(value))) {
      const innerKeys = columnsFromRows(values as Array<Record<string, unknown>>);
      const flag = innerKeys.find((inner) => preferred.includes(inner) || /hit|win|correct|success/i.test(inner));
      if (flag) {
        return {
          key: `${key}.${flag}`,
          isWin: (value: unknown) => {
            const cell = (value as Record<string, unknown>)?.[flag];
            return cell === true || cell === 1 || cell === "true";
          },
        };
      }
    }
  }
  return null;
}

function FieldList({ value, exclude }: { value: unknown; exclude?: string[] }) {
  const fields = flattenFields(value).filter((field) => !exclude?.includes(field.key));
  if (!fields.length) return null;
  return (
    <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.key} className="flex flex-wrap items-baseline gap-2 text-sm">
          <dt className="text-xs uppercase tracking-wide text-ink-mute">{field.key}</dt>
          <dd className="tabular-nums text-ink">
            {field.value || (field.items !== undefined ? `${field.items} items` : "—")}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DataTable({ rows, caption }: { rows: Array<Record<string, unknown>>; caption: string }) {
  const columns = columnsFromRows(rows);
  if (!rows.length || !columns.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-navy-700">
            {columns.map((key) => (
              <th key={key} scope="col" className="py-2 pr-4 text-xs uppercase tracking-wide text-ink-mute">
                {key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-b border-navy-800/70 align-top">
              {columns.map((key) => (
                <td key={key} className="max-w-[28rem] py-2 pr-4 tabular-nums text-ink-dim">
                  {cellValue(row[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultsTab({ runs, error }: { runs: Run[]; error: string | null }) {
  if (error) {
    return <p className="card-surface p-4 text-sm text-bad">The benchmark runs could not be read: {error}</p>;
  }
  if (!runs.length) {
    return (
      <p className="card-surface p-4 text-sm text-ink-dim">
        The engine returned no benchmark runs. The numbers below are from questions asked on this page.
      </p>
    );
  }
  return (
    <ul className="space-y-4">
      {runs.map((run) => (
        <li key={run.id} className="card-surface p-4">
          <h3 className="headline text-base">{run.label}</h3>
          <p className="mt-0.5 text-xs text-ink-mute">
            run id <code className="text-ink-dim">{run.id}</code>
          </p>
          <div className="mt-3">
            <FieldList value={run.payload} exclude={ROW_KEYS.filter((key) => Array.isArray(run.payload[key]))} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function PerQueryTab({ runs, error }: { runs: Run[]; error: string | null }) {
  const [runId, setRunId] = useState("");
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const active = runId || runs[0]?.id || "";

  useEffect(() => {
    if (!active) return;
    let live = true;
    setLoading(true);
    setLoadError(null);
    setPayload(null);
    api
      .benchmarkRun(active)
      .then((res) => {
        if (live) setPayload(res);
      })
      .catch((err: Error) => {
        if (live) setLoadError(err.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [active]);

  if (error) return <p className="card-surface p-4 text-sm text-bad">{error}</p>;
  if (!runs.length)
    return (
      <p className="card-surface p-4 text-sm text-ink-dim">
        No benchmark runs have been published by the engine yet.
      </p>
    );

  const found = payload ? findRows(payload) : null;
  const rows = found?.rows ?? [];
  const outcome = findOutcomeFlag(rows);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="run" className="eyebrow">
          Run
        </label>
        <select
          id="run"
          value={active}
          onChange={(event) => setRunId(event.target.value)}
          className="rounded-md border border-navy-600 bg-navy-950 px-3 py-1.5 text-sm text-ink focus:border-cyan focus:outline-none"
        >
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.label}
            </option>
          ))}
        </select>
      </div>

      {loading ? <p className="text-sm text-ink-dim">Loading…</p> : null}
      {loadError ? <p className="card-surface p-4 text-sm text-bad">{loadError}</p> : null}

      {payload && !loading ? (
        <>
          <div className="card-surface p-4">
            <h3 className="eyebrow mb-2">Run totals as returned</h3>
            <FieldList
              value={payload}
              exclude={[...(found ? [found.key] : []), ...ROW_KEYS.filter((key) => Array.isArray(payload[key]))]}
            />
          </div>

          {outcome ? (
            <div className="card-surface p-4">
              <h3 className="eyebrow mb-2">Wins and losses for this run</h3>
              <p className="text-sm text-ink">
                Counted from the engine&apos;s own <code className="text-cyan-soft">{outcome.key}</code> flag:{" "}
                <span className="text-ok">{rows.filter((r) => outcome.isWin(r)).length} won</span> ·{" "}
                <span className="text-bad">{rows.filter((r) => !outcome.isWin(r)).length} lost</span> of{" "}
                {rows.length} questions.
              </p>
            </div>
          ) : rows.length ? (
            <p className="card-surface p-4 text-sm text-ink-dim">
              This run did not return a win or loss flag per question, so nothing is counted as won or lost.
              Every field it did return is listed below, unchanged.
            </p>
          ) : null}

          {rows.length ? (
            <DataTable rows={rows} caption={`Per-query results for run ${active}`} />
          ) : (
            !loading && !loadError ? (
              <p className="card-surface p-4 text-sm text-ink-dim">
                This run returned no per-query rows.
              </p>
            ) : null
          )}
        </>
      ) : null}
    </div>
  );
}

function StatBlock({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card-surface p-3">
      <p className="eyebrow">{label}</p>
      <p className="mt-1 text-lg tabular-nums text-ink">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-mute">{hint}</p> : null}
    </div>
  );
}

function QueryLogTab({
  rows,
  summary,
  reason,
  error,
}: {
  rows: QueryLogRow[];
  summary: Awaited<ReturnType<typeof api.queryLog>>["summary"];
  reason: string | null;
  error: string | null;
}) {
  if (error || !summary) {
    return (
      <p className="card-surface p-4 text-sm text-ink-dim">
        {reason ?? error ?? "The query log is empty."}{" "}
        Questions asked here appear in this list once they are logged.
      </p>
    );
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatBlock label="Questions logged" value={numberOrDash(summary.questions)} />
        <StatBlock
          label="Answers with a citation"
          value={numberOrDash(summary.answers)}
          hint={`of ${numberOrDash(summary.questions)} logged`}
        />
        <StatBlock label="Abstentions" value={numberOrDash(summary.abstentions)} />
        <StatBlock label="Failures" value={numberOrDash(summary.errors)} />
        <StatBlock
          label="Median confidence"
          value={summary.confidence.median === null ? "—" : percent(summary.confidence.median)}
          hint={`across ${numberOrDash(summary.confidence.samples)} checked answers`}
        />
        <StatBlock
          label="95th percentile confidence"
          value={summary.confidence.p95 === null ? "—" : percent(summary.confidence.p95)}
        />
      </div>

      <section>
        <h3 className="eyebrow mb-2">Time per step, from the logged questions</h3>
        <DataTable
          caption="Stage timings measured from the query log"
          rows={summary.stages.map((stage) => ({
            stage: stage.stage,
            samples: stage.samples,
            skipped: stage.skipped_count,
            median_ms: stage.median_ms,
            median_shown: ms(stage.median_ms),
            p95_ms: stage.p95_ms,
            p95_shown: ms(stage.p95_ms),
            max_ms: (stage as { max_ms?: number | null }).max_ms ?? null,
            measured_on: stage.local ? "this site" : "engine",
          }))}
        />
        <p className="mt-1 text-xs text-ink-mute">
          The *_ms columns are the raw values; the “shown” columns are the same numbers spelled out for
          reading. Nothing is rounded away.
        </p>
      </section>

      <section>
        <h3 className="eyebrow mb-2">Every logged question ({rows.length} shown)</h3>
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id} className="card-surface p-3">
              <p className="text-sm text-ink">{row.question}</p>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-mute">
                <span>{dateTime(row.asked_at)}</span>
                <span>
                  confidence: {row.confidence === null ? "not returned" : rawValue(row.confidence)}
                </span>
                <span className={cn(row.abstain && "text-gold")}>
                  {row.abstain ? "abstained" : "answered"}
                </span>
                <span>
                  citations: {row.cited_case_ids.length ? row.cited_case_ids.join(", ") : "none"}
                </span>
                {row.error ? <span className="text-bad">error: {row.error}</span> : null}
              </p>
              <p className="mt-1 text-xs text-ink-mute">
                steps:{" "}
                {row.stages.length
                  ? row.stages
                      .map((stage) =>
                        stage.skipped
                          ? `${stage.stage} skipped${stage.reason ? ` (${stage.reason})` : ""}`
                          : `${stage.stage} ${ms(stage.duration_ms)}`,
                      )
                      .join(" · ")
                  : "not recorded"}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-ink-mute">
          Stored with the asker&apos;s name, device and address removed, and with any email, phone number or
          long reference number stripped out of the question text. Times are rounded to the hour.
        </p>
      </section>

      {summary.per_hour.length ? (
        <section>
          <h3 className="eyebrow mb-2">Questions per hour</h3>
          <DataTable
            caption="Question counts by hour"
            rows={summary.per_hour.map((item) => ({ hour: item.hour, questions: item.count }))}
          />
        </section>
      ) : null}
    </div>
  );
}

export default function Benchmarks() {
  const [runsRaw, setRunsRaw] = useState<unknown[] | null>(null);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [log, setLog] = useState<Awaited<ReturnType<typeof api.queryLog>> | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .benchmarks()
      .then((res) => {
        if (!live) return;
        setRunsRaw(Array.isArray(res.runs) ? res.runs : []);
        setRunsError(res.error ?? null);
      })
      .catch((err: Error) => {
        if (live) {
          setRunsRaw([]);
          setRunsError(err.message);
        }
      });
    api
      .queryLog()
      .then((res) => {
        if (live) setLog(res);
      })
      .catch((err: Error) => {
        if (live) {
          setLog(null);
          setLogError(err.message);
        }
      });
    return () => {
      live = false;
    };
  }, []);

  const runs = useMemo(
    () => (runsRaw ?? []).map((item, index) => pickRun(item, index)).filter((run): run is Run => Boolean(run)),
    [runsRaw],
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6">
      <h1 className="headline text-2xl">How it performs, in the open</h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-dim">
        No account, nothing hidden. The numbers are the engine&apos;s own output, shown as they come back.
      </p>

      <Tabs defaultValue="results">
        <TabsList>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="per-query">Per-query wins and losses</TabsTrigger>
          <TabsTrigger value="log">Query log</TabsTrigger>
        </TabsList>

        <TabsContent value="results">
          {runsRaw === null ? (
            <p className="text-sm text-ink-dim">Loading benchmark runs…</p>
          ) : (
            <ResultsTab runs={runs} error={runsError} />
          )}
        </TabsContent>

        <TabsContent value="per-query">
          {runsRaw === null ? (
            <p className="text-sm text-ink-dim">Loading benchmark runs…</p>
          ) : (
            <PerQueryTab runs={runs} error={runsError} />
          )}
        </TabsContent>

        <TabsContent value="log">
          {log === null && !logError ? (
            <p className="text-sm text-ink-dim">Loading the query log…</p>
          ) : (
            <QueryLogTab
              rows={log?.rows ?? []}
              summary={log?.summary ?? null}
              reason={log?.reason ?? null}
              error={logError}
            />
          )}
        </TabsContent>
      </Tabs>

      <p className="mt-8 text-xs text-ink-mute">
        Research aid only. Not legal advice. Always read the full opinion.
      </p>
    </div>
  );
}
