/**
 * Thin retrieval endpoint (build plan §C step 4) — exposes query-understanding +
 * hybrid retrieval + rerank + parent-expansion in isolation, so the eval harness can
 * measure retrieval-hit-rate before grounded generation (Phase D) exists. This is a
 * temporary diagnostic surface, not the final product endpoint (which will stream
 * the full obligation map per system design §8).
 *
 * SERVER-ONLY. Uses the service-role admin client (never exposed to the browser).
 */
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { understand } from "@/server/pipeline/understand";
import { getActiveSnapshotId, runRetrieval } from "@/server/pipeline/retrieve";

export const Route = createFileRoute("/api/retrieve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { input?: unknown; frameworkId?: unknown };
        try {
          body = await request.json();
        } catch {
          return json({ error: "Request body must be JSON" }, { status: 400 });
        }
        const input = body.input;
        if (typeof input !== "string" || input.trim() === "") {
          return json({ error: "Missing required string field: input" }, { status: 400 });
        }
        const frameworkId = typeof body.frameworkId === "string" ? body.frameworkId : undefined;

        // Stage timing — a diagnostic endpoint should show where time actually goes,
        // not force guessing from black-box round-trip latency (a batched-embedding
        // fix showed no measurable improvement in practice; this is how we find out
        // why instead of speculating further).
        const t0 = Date.now();
        const timings: Record<string, number> = {};

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const understanding = await understand(input);
          timings.understand_ms = Date.now() - t0;
          if (!understanding.sufficient) {
            return json({ understanding, clarify: true, timings_ms: timings });
          }

          const tSnap = Date.now();
          const snapshotId = await getActiveSnapshotId(supabaseAdmin);
          timings.get_snapshot_ms = Date.now() - tSnap;

          const tRetrieve = Date.now();
          const { reranked, parents, timings: retrievalTimings } = await runRetrieval(
            supabaseAdmin,
            understanding,
            input,
            { snapshotId, frameworkId },
          );
          timings.retrieval_ms = Date.now() - tRetrieve;
          Object.assign(timings, retrievalTimings);
          timings.total_ms = Date.now() - t0;

          return json({
            understanding,
            snapshot_id: snapshotId,
            timings_ms: timings,
            reranked: reranked.map((r) => ({
              citation_label: r.citation_label,
              framework_id: r.framework_id,
              rerank_score: r.rerankScore,
            })),
            parents: parents.map((p) => ({
              citation_label: p.citation_label,
              framework_id: p.framework_id,
              hierarchy_path: p.hierarchy_path,
              supporting_chunks: p.supporting_chunks,
            })),
          });
        } catch (err) {
          // Never let a pipeline failure fall through to a fabricated/partial answer
          // or an opaque HTML error page — a clean JSON error, retry-able by the
          // caller (system design §15).
          console.error("retrieve endpoint failed:", err);
          const message = err instanceof Error ? err.message : String(err);
          return json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
