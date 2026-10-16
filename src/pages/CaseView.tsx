import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import type { CaseDetail, EnginePassage } from "@shared/types";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cellValue, flattenFields, highlightText, rangesForPassage } from "@/lib/render";
import { cn } from "@/lib/utils";

interface CiteState {
  quote?: string;
  chunkId?: string;
}

function authorityItems(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
  if (value && typeof value === "object") {
    const nested = Object.values(value as Record<string, unknown>).filter((v) => Array.isArray(v));
    if (nested.length) {
      const out: Array<Record<string, unknown>> = [];
      for (const list of nested) out.push(...(list as Array<Record<string, unknown>>));
      return out.filter((item) => item && typeof item === "object");
    }
  }
  return [];
}

function idOf(item: Record<string, unknown>): string | null {
  for (const key of ["id", "case_id", "doc_id", "target", "source"]) {
    const value = item[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

export default function CaseView() {
  const { id = "" } = useParams();
  const location = useLocation();
  const [params] = useSearchParams();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const citedRef = useRef<HTMLLIElement | null>(null);

  const state = (location.state ?? null) as CiteState | null;
  const quote = state?.quote || params.get("quote") || "";
  const chunkId = state?.chunkId || params.get("chunk") || "";

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    api
      .caseDetail(id)
      .then((res) => {
        if (live) setDetail(res);
      })
      .catch((err: Error) => {
        if (live) setError(err.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    if (citedRef.current) citedRef.current.scrollIntoView({ block: "center" });
  }, [detail]);

  const passages: EnginePassage[] = detail?.passages ?? [];
  const citedPassage = useMemo(
    () => passages.find((p) => (chunkId ? p.chunk_id === chunkId : false)) ?? (!chunkId && quote ? passages.find((p) => p.text.includes(quote)) : undefined),
    [passages, chunkId, quote],
  );
  const caseFields = detail ? flattenFields(detail.case) : [];
  const authorityList = useMemo(() => authorityItems(detail?.authority), [detail]);
  const authorityFields = useMemo(() => {
    if (!detail || authorityList.length) return [];
    return flattenFields(detail.authority);
  }, [detail, authorityList.length]);

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/demo" className="text-sm text-cyan-soft underline-offset-4 hover:underline">
          Back to the search
        </Link>
        <span className="text-xs text-ink-mute">Opinion as stored in the collection</span>
      </div>

      {loading ? <p className="mt-6 text-sm text-ink-dim">Loading the opinion…</p> : null}
      {error ? (
        <div className="card-surface mt-6 border-bad/40 p-4 text-sm text-bad">
          The opinion could not be shown: {error}
        </div>
      ) : null}

      {detail ? (
        <>
          <h1 className="headline mt-4 text-[1.6rem] leading-tight">
            {detail.case.name || detail.case.id}
          </h1>
          <p className="mt-1 text-sm text-ink-dim">
            {[detail.case.court, detail.case.year].filter(Boolean).join(" · ") || "Court and year not returned"}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {detail.case.link ? (
              <Button asChild size="sm" variant="primary">
                <a href={detail.case.link} target="_blank" rel="noreferrer">
                  Read the full opinion
                </a>
              </Button>
            ) : (
              <span className="text-xs text-ink-mute">
                The engine returned no external link for this opinion.
              </span>
            )}
            {quote ? (
              <span className="text-xs text-ink-mute">
                Highlighted below: the passage your answer leaned on{chunkId ? ` (passage ${chunkId})` : ""}.
              </span>
            ) : null}
          </div>

          {caseFields.length ? (
            <section aria-labelledby="details-heading" className="card-surface mt-5 p-4">
              <h2 id="details-heading" className="eyebrow mb-2">
                Case details as returned
              </h2>
              <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {caseFields.map((field) => (
                  <div key={field.key} className="flex flex-wrap items-baseline gap-2 text-sm">
                    <dt className="text-xs uppercase tracking-wide text-ink-mute">{field.key}</dt>
                    <dd className="min-w-0 text-ink">
                      {field.value || `${field.items ?? 0} items`}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {authorityList.length || authorityFields.length ? (
            <section aria-labelledby="authority-heading" className="card-surface mt-4 p-4">
              <h2 id="authority-heading" className="eyebrow mb-2">
                Authority the engine reported
              </h2>
              {authorityFields.map((field) => (
                <p key={field.key} className="text-sm text-ink-dim">
                  <span className="text-xs uppercase tracking-wide text-ink-mute">{field.key}</span>{" "}
                  {field.value || `${field.items ?? 0} items`}
                </p>
              ))}
              <ul className="mt-2 space-y-1.5">
                {authorityList.slice(0, 40).map((item, index) => {
                  const target = idOf(item);
                  const label =
                    typeof item.name === "string" && item.name
                      ? item.name
                      : typeof item.case_name === "string" && item.case_name
                        ? item.case_name
                        : target || `entry ${index + 1}`;
                  const fields = Object.entries(item)
                    .filter(([key]) => !["id", "case_id", "doc_id", "target", "source", "name", "case_name"].includes(key))
                    .map(([key, value]) => `${key}: ${cellValue(value)}`)
                    .join(" · ");
                  return (
                    <li key={index} className="text-sm">
                      {target ? (
                        <Link
                          to={`/cases/${encodeURIComponent(target)}`}
                          className="text-cyan-soft underline-offset-4 hover:underline"
                        >
                          {label}
                        </Link>
                      ) : (
                        <span className="text-ink">{label}</span>
                      )}
                      {fields ? <span className="ml-2 text-xs text-ink-mute">{fields}</span> : null}
                    </li>
                  );
                })}
              </ul>
              {authorityList.length > 40 ? (
                <p className="mt-2 text-xs text-ink-mute">
                  Showing 40 of {authorityList.length} entries returned.
                </p>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="passages-heading" className="mt-6">
            <h2 id="passages-heading" className="headline text-lg">
              Stored passages ({passages.length})
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-mute">
              These are the passages the collection holds for this opinion — the words the search was allowed
              to read. A gold highlight is the span quoted in your answer; a cyan highlight is a span the
              engine marked in the passage.
            </p>
            {passages.length ? (
              <ol className="mt-3 space-y-3">
                {passages.map((passage) => {
                  const isCited = citedPassage?.chunk_id === passage.chunk_id;
                  const ranges = rangesForPassage(
                    passage.text,
                    passage.spans,
                    isCited && quote ? quote : undefined,
                  );
                  return (
                    <li
                      key={passage.chunk_id}
                      ref={isCited ? citedRef : undefined}
                      className={cn(
                        "card-surface p-4",
                        isCited && "border-gold/50 bg-gold/5",
                      )}
                    >
                      <p className="eyebrow mb-2">
                        Passage {passage.chunk_id}
                        {isCited ? " · quoted in your answer" : ""}
                      </p>
                      <p className="font-serif text-[1rem] leading-[1.75] text-ink">
                        {highlightText(passage.text, ranges)}
                      </p>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-ink-dim">
                The engine returned no stored passages for this opinion. Read it at the source above.
              </p>
            )}
          </section>
        </>
      ) : null}

      <p className="mt-8 text-xs text-ink-mute">
        Research aid only. Not legal advice. Always read the full opinion.
      </p>
    </div>
  );
}
