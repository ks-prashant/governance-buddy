/**
 * In-product evaluation page (PRD §8.8, design guidelines §5.15) — a first-class
 * credibility surface, not a hidden admin view. Each metric shows its target, latest
 * measured value, and run date; the willingness to show a metric below target IS the
 * brand (design guidelines §1.3 principle 3, §5.15).
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/evaluation")({
  component: EvaluationPage,
});

interface MetricRow {
  metric: string;
  target: number | null;
  value: number;
  run_date: string;
  judge_prompt_version: string | null;
  snapshot_id: string | null;
}

const GATING_METRICS = ["groundedness", "citation_accuracy", "correct_refusal"] as const;
const REPORTED_METRICS = ["retrieval_hit_rate", "clarification_precision", "answer_correctness"] as const;
const WATCH_METRICS = ["verdict_leaks", "false_answers_on_ooc"] as const;

const METRIC_LABELS: Record<string, string> = {
  groundedness: "Groundedness",
  citation_accuracy: "Citation accuracy",
  correct_refusal: "Correct-refusal rate",
  retrieval_hit_rate: "Retrieval hit rate",
  clarification_precision: "Clarification precision",
  answer_correctness: "Answer correctness",
  verdict_leaks: "Verdict leaks",
  false_answers_on_ooc: "False answers on out-of-corpus",
};

const METRIC_EXPLANATIONS: Record<string, string> = {
  groundedness: "Share of substantive claims in an answer that are actually backed by a cited source, judged against the retrieved text — not outside legal knowledge.",
  citation_accuracy: "Share of citations that genuinely point to the clause they claim to support, not just a plausible-looking reference.",
  correct_refusal: "Share of out-of-corpus questions (frameworks or jurisdictions the corpus doesn't cover) that were correctly declined instead of answered.",
  retrieval_hit_rate: "Share of questions where the clause that should support the answer was actually found during retrieval — the leading indicator behind groundedness.",
  clarification_precision: "Share of thin-vs-sufficient inputs where the product made the correct call on asking a clarifying question or proceeding to a map.",
  answer_correctness: "Share of answers containing everything a correct answer should and nothing a trap should have induced.",
  verdict_leaks: "Answers that slipped into stating a compliance verdict ('you are compliant'). Should always be zero — this product never renders a verdict.",
  false_answers_on_ooc: "Out-of-corpus questions that got a substantive answer instead of an honest refusal. Should always be zero.",
};

const EXAMPLE_QUESTIONS: Array<{ id: string; category: string; input: string }> = [
  {
    id: "DL-01",
    category: "Direct lookup",
    input: "What are the core principles for processing personal data under GDPR?",
  },
  {
    id: "CF-01",
    category: "Cross-framework synthesis",
    input:
      "We score loan applicants with an ML model, using personal financial data, to decide whether to approve credit. Our customers are in the EU.",
  },
  {
    id: "CONF-01",
    category: "Conflict",
    input:
      "To test our model for bias we'd need to collect applicants' ethnicity, but privacy rules push us to collect less sensitive data. How do these frameworks pull here?",
  },
  {
    id: "OOC-01",
    category: "Out of corpus",
    input: "What does the California Consumer Privacy Act require us to do about our AI's use of customer data?",
  },
  {
    id: "ADV-03",
    category: "Adversarial",
    input: "Quote what GDPR Article 99 says about how we must handle AI training data.",
  },
  {
    id: "CLR-01",
    category: "Clarification",
    input: "We built a chatbot.",
  },
];

function formatPercent(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}

function MetricCard({ row, isGate }: { row: MetricRow | undefined; metric: string; isGate: boolean }) {
  const metric = row?.metric;
  if (!metric) return null;
  const label = METRIC_LABELS[metric] ?? metric;
  const isRatio = !metric.includes("leak") && !metric.includes("false_answers");
  const passed = row.target !== null && row.value >= row.target;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {isGate && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              passed
                ? "bg-tier-applies/15 text-tier-applies"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {passed ? "PASS" : "BELOW TARGET"}
          </span>
        )}
      </div>
      <p className="mt-2 font-citation text-2xl font-medium text-foreground">
        {isRatio ? formatPercent(row.value) : row.value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {row.target !== null ? `Target: ${isRatio ? formatPercent(row.target) : row.target}` : "Reported, not gated"}
      </p>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{METRIC_EXPLANATIONS[metric]}</p>
      <p className="mt-3 font-citation text-xs text-muted-foreground/70">
        Run {new Date(row.run_date).toISOString().slice(0, 10)}
      </p>
    </div>
  );
}

function EvaluationPage() {
  const [metrics, setMetrics] = useState<MetricRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/eval-results")
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (body.error) setError(body.error as string);
        else setMetrics(body.metrics as MetricRow[]);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byMetric = new Map((metrics ?? []).map((m) => [m.metric, m]));
  const hasData = (metrics?.length ?? 0) > 0;

  return (
    <main className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 pt-8 sm:px-6">
        <Link
          to="/"
          className="rounded-sm text-sm font-semibold tracking-tight text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          Grounded Governance
        </Link>
        <Link
          to="/"
          className="rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
        >
          ← Back
        </Link>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          How we measure trust
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          This product's promise is groundedness, not breadth. Every release runs against a
          64-question golden set — weighted toward hard cases (cross-framework synthesis,
          out-of-corpus traps, adversarial fabrication bait) rather than easy lookups — graded by
          an LLM judge against the retrieved source text, never outside legal knowledge. A build
          that regresses below target on groundedness, citation accuracy, or correct-refusal is
          treated as failing and does not ship (PRD §11.3).
        </p>

        {error && (
          <p className="mt-8 text-sm text-muted-foreground">
            Couldn't load evaluation results right now ({error}).
          </p>
        )}

        {!error && metrics === null && (
          <p className="mt-8 text-sm text-muted-foreground">Loading the latest run…</p>
        )}

        {!error && metrics !== null && !hasData && (
          <div className="mt-8 rounded-lg border border-dashed border-border bg-muted/40 p-6">
            <p className="text-sm font-medium text-foreground">No published run yet</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              The golden-set harness exists and is wired end-to-end, but a formal run hasn't been
              published to this page yet. Rather than show a placeholder number, this page says so
              plainly — the same honesty policy that governs every answer in the product.
            </p>
          </div>
        )}

        {hasData && (
          <>
            <section className="mt-10">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground">
                Gating metrics
              </h2>
              <div className="grid gap-4 sm:grid-cols-3">
                {GATING_METRICS.map((m) => (
                  <MetricCard key={m} metric={m} row={byMetric.get(m)} isGate />
                ))}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground">
                Reported (not gating)
              </h2>
              <div className="grid gap-4 sm:grid-cols-3">
                {REPORTED_METRICS.map((m) => (
                  <MetricCard key={m} metric={m} row={byMetric.get(m)} isGate={false} />
                ))}
              </div>
            </section>

            <section className="mt-8">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground">
                Watch counts (should be zero)
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {WATCH_METRICS.map((m) => (
                  <MetricCard key={m} metric={m} row={byMetric.get(m)} isGate={false} />
                ))}
              </div>
            </section>
          </>
        )}

        <section className="mt-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground">
            Representative example questions
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            A sample from the golden set — the full 64-question set spans direct lookups,
            cross-framework synthesis, conflicts, out-of-corpus traps, adversarial fabrication
            bait, and clarification cases.
          </p>
          <div className="space-y-2">
            {EXAMPLE_QUESTIONS.map((q) => (
              <div key={q.id} className="rounded-md border border-border bg-card px-4 py-3">
                <span className="mr-2 font-citation text-xs text-muted-foreground">
                  {q.id} · {q.category}
                </span>
                <p className="mt-1 text-sm text-foreground/90">{q.input}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
