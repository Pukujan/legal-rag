import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FinalAnswer, RetrievalResult, StageEvent } from "@shared/types";
import AnswerView from "@/components/AnswerView";
import StarField, { describeScene } from "@/components/StarField";
import WorkflowChain, { orderStages } from "@/components/WorkflowChain";
import { Button } from "@/components/ui/button";
import { api, askStream } from "@/lib/api";
import type { HealthResponse } from "@/lib/api";
import { HIT_WORD } from "@/lib/scene";
import { SceneGraph } from "@/lib/scene";
import { provenanceLine, rawValue } from "@/lib/render";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/useReducedMotion";

type Phase = "idle" | "running" | "done" | "failed";

const EXAMPLES = [
  "What must a plaintiff show before a court will imply a covenant of good faith?",
  "When does a federal court abstain from hearing a case that a state court is already deciding?",
  "Is a contract enforceable when one side signed after learning the deal was one-sided?",
];

export default function Demo() {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const sceneRef = useRef(new SceneGraph());
  const abortRef = useRef<(() => void) | null>(null);

  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [stages, setStages] = useState<StageEvent[]>([]);
  const [results, setResults] = useState<RetrievalResult[]>([]);
  const [answer, setAnswer] = useState<FinalAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    let live = true;
    api
      .health()
      .then((res) => {
        if (live) setHealth(res);
      })
      .catch(() => {
        if (live) setHealth(null);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => () => abortRef.current?.(), []);

  const bump = useCallback(() => setRevision((r) => r + 1), []);

  const start = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed.length < 8) {
        setError("Ask a full question — at least a few words, so there is something to look up.");
        setPhase("failed");
        return;
      }
      abortRef.current?.();
      sceneRef.current.reset();
      setAsked(trimmed);
      setPhase("running");
      setStages([]);
      setResults([]);
      setAnswer(null);
      setError(null);
      setHoveredId(null);
      bump();

      abortRef.current = askStream(trimmed, {
        onStage: (event) => {
          setStages((prev) => [...prev.filter((s) => s.stage !== event.stage), event]);
          sceneRef.current.applyStage(event);
          bump();
        },
        onResult: (list) => {
          setResults(list);
          sceneRef.current.applyResults(list);
          bump();
        },
        onAnswer: (final) => {
          setAnswer(final);
          sceneRef.current.markCited((final.cited_cases ?? []).map((c) => c.case.id));
          setPhase("done");
          bump();
        },
        onLog: () => undefined,
        onError: (err) => {
          setError(err.message);
          setPhase("failed");
        },
        onDone: () => {
          setPhase((prev) => (prev === "running" ? "done" : prev));
        },
      });
    },
    [bump],
  );

  const openCase = useCallback(
    (id: string, cite?: { quote: string; chunkId: string }) => {
      const params = new URLSearchParams();
      if (cite?.chunkId) params.set("chunk", cite.chunkId);
      if (cite?.quote) params.set("quote", cite.quote.slice(0, 500));
      const query = params.toString();
      navigate(
        `/cases/${encodeURIComponent(id)}${query ? `?${query}` : ""}`,
        { state: cite ? { quote: cite.quote, chunkId: cite.chunkId } : null },
      );
    },
    [navigate],
  );

  const workflow = useMemo(() => orderStages(stages), [stages]);
  const summary = useMemo(() => sceneRef.current.summary(), [revision, sceneRef]);
  const engineStatus = health?.health?.status ?? (health ? "unknown" : "not checked");
  const engineBlocked = Boolean(health && health.health?.status && health.health.status !== "ready");
  const canAsk = question.trim().length >= 8 && phase !== "running" && !engineBlocked;

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-6">
      <h1 className="headline text-2xl">Ask about case law</h1>
      <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-dim">
        Ask one question at a time. Each step of the search appears as it happens, and the answer comes
        with the passage behind every sentence.
      </p>
      <p className="mt-2 max-w-prose text-xs leading-relaxed text-ink-mute">
        Your question is logged without your name, your device or any contact details that appear in it,
        and the logged questions are published on the Benchmarks page. Do not paste anything confidential.
      </p>

      <form
        className="mt-4 card-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          start(question);
        }}
      >
        <label htmlFor="question" className="eyebrow">
          Your question
        </label>
        <textarea
          id="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={3}
          placeholder="For example: What must a plaintiff show before a court will imply a covenant of good faith?"
          className="mt-2 w-full resize-y rounded-md border border-navy-600 bg-navy-950/80 p-3 text-sm text-ink placeholder:text-ink-mute focus:border-cyan focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!canAsk} className="h-10 px-5">
            {phase === "running" ? (results.length ? "Writing the answer…" : "Searching…") : "Search the opinions"}
          </Button>
          {phase === "running" ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => abortRef.current?.()}>
              Stop
            </Button>
          ) : null}
          <span className="text-xs text-ink-mute" aria-live="polite">
            {engineBlocked
              ? `The opinion collection is not ready yet (status: ${engineStatus}). Try again in a moment.`
              : phase === "running"
                ? results.length
                  ? "The opinions are on the map. The answer is being written from those passages."
                  : "Each step will light up as it finishes."
                : `Search engine status: ${engineStatus}.`}
          </span>
        </div>
        {phase === "idle" ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => {
                  setQuestion(example);
                  start(example);
                }}
                className="rounded-full border border-navy-600 px-3 py-1 text-left text-xs text-ink-dim transition-colors hover:border-cyan/60 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}
      </form>

      <div className="mt-5 flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start">
        <aside className="order-1 space-y-3 lg:order-2 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
          <section
            aria-label="The opinions that surfaced"
            className="card-surface relative overflow-hidden"
          >
            <StarField
              scene={sceneRef.current}
              revision={revision}
              mode="live"
              compact
              reducedMotion={reducedMotion}
              hoveredId={hoveredId}
              onHover={setHoveredId}
              onOpenCase={(id) => openCase(id)}
              className="h-44 w-full lg:h-[24rem]"
            />
            <div className="border-t border-navy-800 bg-navy-950/80 px-3 py-2">
              <p className="text-[0.7rem] leading-relaxed text-ink-mute">
                <span aria-hidden="true" className="mr-1 inline-block h-2 w-2 rounded-full bg-[#f7eeda]" />
                your words matched
                <span aria-hidden="true" className="mx-1 ml-3 inline-block h-2 w-2 rounded-full bg-cyan" />
                the meaning matched
                <span aria-hidden="true" className="mx-1 ml-3 inline-block h-2 w-2 rounded-full bg-gold" />
                both · ring = quoted in the answer · number = rank
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-dim" aria-live="polite">
                {describeScene(summary)}
              </p>
              {reducedMotion ? (
                <p className="mt-1 text-xs text-ink-mute">
                  Motion is turned off in your browser settings, so the field stays still and every change
                  below is written out in words instead.
                </p>
              ) : null}
            </div>
          </section>

          <section aria-label="Steps the search took" className="card-surface p-3">
            <h2 className="eyebrow mb-2">Steps</h2>
            <WorkflowChain layout="row" stages={workflow} started={phase !== "idle"} className="lg:hidden" />
            <WorkflowChain
              layout="column"
              stages={workflow}
              started={phase !== "idle"}
              className="hidden lg:block"
            />
            {phase === "idle" ? (
              <p className="mt-2 text-xs text-ink-mute">
                Nothing has run yet. The steps fill in as the search goes: read the question, word matches,
                meaning matches, shortlist, citation graph, re-ranking, evidence, writing, checking.
              </p>
            ) : null}
          </section>
        </aside>

        <section aria-label="Your question and the answer" className="order-2 min-w-0 lg:order-1">
          {phase === "running" ? (
            <p className="text-sm text-ink-dim" aria-live="polite">
              Searching for “{asked}” — the steps on the right fill in as they finish.
            </p>
          ) : null}
          {error ? (
            <div className="card-surface border-bad/40 p-3 text-sm text-bad">
              The search stopped: {error}
              {results.length ? " The passages found before it stopped are listed below." : ""}
            </div>
          ) : null}

          {answer ? (
            <AnswerView
              answer={answer}
              hoveredId={hoveredId}
              onHoverCase={setHoveredId}
              onOpenCase={openCase}
            />
          ) : null}

          {results.length ? (
            <section aria-labelledby="surfaced-heading" className="mt-5">
              <h2 id="surfaced-heading" className="eyebrow mb-2">
                Opinions retrieved ({results.length})
              </h2>
              <ul className="space-y-2">
                {results.map((result) => {
                  const node = sceneRef.current.byId(result.case.id);
                  const kindWord = node ? HIT_WORD[node.kind] : HIT_WORD.pending;
                  return (
                    <li
                      key={result.case.id}
                      className={cn(
                        "card-surface p-3",
                        hoveredId === result.case.id && "border-cyan/60",
                      )}
                      onMouseEnter={() => setHoveredId(result.case.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => openCase(result.case.id)}
                          className="text-left font-serif text-[1rem] text-ink hover:text-cyan-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan"
                        >
                          {result.case.name || result.case.id}
                        </button>
                        <span className="text-xs tabular-nums text-ink-mute">
                          rank {rawValue(result.rank)} · score {rawValue(result.score)}
                          {result.score_kind ? ` (${result.score_kind})` : ""}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-mute">
                        {[result.case.court, result.case.year].filter(Boolean).join(" · ")} · found as a{" "}
                        {kindWord}
                      </p>
                      {result.provenance?.length ? (
                        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-ink-dim">
                          {result.provenance.map((note, i) => (
                            <li key={i}>{provenanceLine(note)}</li>
                          ))}
                        </ul>
                      ) : null}
                      {result.passages?.length ? (
                        <blockquote className="mt-2 border-l-2 border-cyan/40 pl-3 text-sm italic leading-relaxed text-ink-dim">
                          “{result.passages[0].text.slice(0, 320)}
                          {result.passages[0].text.length > 320 ? "…" : ""}”
                        </blockquote>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {phase === "idle" && !results.length ? (
            <div className="card-surface p-4 text-sm leading-relaxed text-ink-dim">
              <p>
                Ask something above. While the search runs you will see each step finish on the right, and the
                opinions light up in the field as they surface: warm white when your words matched the page,
                cyan when the meaning matched in different words, gold when both did.
              </p>
              <p className="mt-2 text-xs text-ink-mute">
                Click any point of light to read the opinion it stands for, with the exact words we looked at
                highlighted.
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
