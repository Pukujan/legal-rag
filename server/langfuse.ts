/**
 * One Langfuse Cloud trace per question asked on the hosted site.
 * Sent on the OpenTelemetry endpoint with the current SDK headers.
 * A missing key or a failed send never changes the answer the page returns.
 */

export interface AskTrace {
  question: string;
  timings: unknown[];
  results: Array<{
    rank?: number;
    score?: number;
    case?: { id?: string; name?: string };
    passages?: Array<{ text?: string }>;
  }>;
  answerText: string | null;
  error: string | null;
  abstain: boolean;
  confidence: number | null;
  cited: string[];
}

function enabled(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

function attr(key: string, value: string | boolean): { key: string; value: Record<string, string | boolean> } {
  return { key, value: typeof value === "boolean" ? { boolValue: value } : { stringValue: value } };
}

function hex(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function recordAsk(trace: AskTrace): Promise<void> {
  if (!enabled() || !trace.question) return;
  const base = (process.env.LANGFUSE_BASE_URL || "https://us.cloud.langfuse.com").replace(/\/+$/, "");
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY as string;
  const secretKey = process.env.LANGFUSE_SECRET_KEY as string;
  const endMs = Date.now();
  const end = `${endMs}000000`;
  const start = `${endMs - 1}000000`;
  const results = trace.results.slice(0, 8).map((row) => ({
    rank: row.rank ?? null,
    id: row.case?.id ?? null,
    name: row.case?.name ?? null,
    score: row.score ?? null,
    passage: (row.passages?.[0]?.text ?? "").slice(0, 320),
  }));
  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attr("service.name", "legal-rag"),
            attr("telemetry.sdk.name", "langfuse-js"),
            attr("telemetry.sdk.language", "nodejs"),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "langfuse-sdk", version: "4" },
            spans: [
              {
                traceId: hex(16),
                spanId: hex(8),
                name: "legal-graph-ask",
                kind: 1,
                startTimeUnixNano: start,
                endTimeUnixNano: end,
                attributes: [
                  attr("langfuse.trace.name", "legal-graph-ask"),
                  attr("langfuse.observation.type", "span"),
                  attr("langfuse.observation.input", JSON.stringify({ question: trace.question })),
                  attr(
                    "langfuse.observation.output",
                    JSON.stringify({
                      answer: trace.answerText,
                      error: trace.error,
                      abstain: trace.abstain,
                      confidence: trace.confidence,
                      cited: trace.cited,
                      results,
                    }),
                  ),
                  attr("langfuse.trace.metadata", JSON.stringify({
                    host: "legal-rag.design-bakery.com",
                    timings: trace.timings,
                  })),
                  attr("langfuse.internal.as_root", true),
                  {
                    key: "langfuse.trace.tags",
                    value: {
                      arrayValue: {
                        values: [{ stringValue: "legal-graph" }, { stringValue: "design-bakery" }],
                      },
                    },
                  },
                ],
                status: trace.error ? { code: 2, message: trace.error.slice(0, 200) } : { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
  const token = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  const res = await fetch(`${base}/api/public/otel/v1/traces`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
      "x-langfuse-sdk-name": "langfuse-js",
      "x-langfuse-sdk-version": "4.4.0",
      "x-langfuse-public-key": publicKey,
      "x-langfuse-ingestion-version": "4",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) {
    console.log(`[langfuse] otel HTTP ${res.status}`);
  }
}
