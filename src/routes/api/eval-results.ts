/**
 * Eval-results endpoint (build plan §H step 1-2, PRD §8.8, §11.3) — the bridge between
 * the offline eval harness (`evals/run_eval.mjs`) and the in-product evaluation page.
 *
 * GET is public (read-only): returns the latest row per metric, for the eval page.
 * POST writes new rows and is gated by a bearer secret (EVAL_WRITE_SECRET) — without
 * this gate, anyone could POST fabricated "we're 99% grounded" numbers to the very page
 * whose entire point is being an honest, unfakeable credibility surface (design
 * guidelines §5.15). This is deliberately a shared-secret check, not a user auth system
 * (PRD §4.2 — no accounts in the MVP); it protects data integrity, not a user identity.
 *
 * SERVER-ONLY. Uses the service-role admin client (RLS is enabled with zero policies on
 * eval_results, system design §14.1 — this route is the only write path).
 */
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

interface MetricRow {
  metric: string;
  target: number | null;
  value: number;
}

export const Route = createFileRoute("/api/eval-results")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data, error } = await supabaseAdmin
            .from("eval_results")
            .select("metric, target, value, run_date, judge_prompt_version, snapshot_id")
            .order("run_date", { ascending: false })
            .limit(200);
          if (error) throw new Error(error.message);

          const latestByMetric = new Map<string, (typeof data)[number]>();
          for (const row of data ?? []) {
            if (!latestByMetric.has(row.metric as string)) {
              latestByMetric.set(row.metric as string, row);
            }
          }

          return json({ metrics: Array.from(latestByMetric.values()) });
        } catch (err) {
          console.error("eval-results GET failed:", err);
          const message = err instanceof Error ? err.message : String(err);
          return json({ error: message }, { status: 500 });
        }
      },

      POST: async ({ request }) => {
        const expected = process.env.EVAL_WRITE_SECRET;
        if (!expected) {
          return json({ error: "EVAL_WRITE_SECRET not configured on the server" }, { status: 503 });
        }
        const authHeader = request.headers.get("authorization") ?? "";
        if (authHeader !== `Bearer ${expected}`) {
          return json({ error: "Unauthorized" }, { status: 401 });
        }

        let body: {
          run_date?: unknown;
          judge_prompt_version?: unknown;
          snapshot_id?: unknown;
          metrics?: unknown;
        };
        try {
          body = await request.json();
        } catch {
          return json({ error: "Request body must be JSON" }, { status: 400 });
        }

        if (!Array.isArray(body.metrics) || body.metrics.length === 0) {
          return json({ error: "metrics must be a non-empty array" }, { status: 400 });
        }
        const metrics = body.metrics as MetricRow[];
        for (const m of metrics) {
          if (typeof m.metric !== "string" || typeof m.value !== "number") {
            return json({ error: "each metric needs {metric: string, value: number}" }, { status: 400 });
          }
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          let snapshotId = typeof body.snapshot_id === "string" ? body.snapshot_id : null;
          if (!snapshotId) {
            const { data: snapshot } = await supabaseAdmin
              .from("corpus_snapshots")
              .select("id")
              .eq("status", "active")
              .single();
            snapshotId = (snapshot?.id as string) ?? null;
          }

          const runDate =
            typeof body.run_date === "string" ? body.run_date : new Date().toISOString();
          const judgePromptVersion =
            typeof body.judge_prompt_version === "string" ? body.judge_prompt_version : null;

          const rows = metrics.map((m) => ({
            run_date: runDate,
            metric: m.metric,
            target: m.target ?? null,
            value: m.value,
            judge_prompt_version: judgePromptVersion,
            snapshot_id: snapshotId,
          }));

          const { error } = await supabaseAdmin.from("eval_results").insert(rows);
          if (error) throw new Error(error.message);

          return json({ inserted: rows.length });
        } catch (err) {
          console.error("eval-results POST failed:", err);
          const message = err instanceof Error ? err.message : String(err);
          return json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
