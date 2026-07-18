/**
 * Corpus-indicator endpoint (build plan §F, design guidelines §5.13) — the active
 * snapshot's date plus each framework's version label, for the persistent
 * "Corpus as of [date]" indicator (PRD §8.7 FR-7.1). Never claims current law beyond
 * this labeled snapshot.
 *
 * SERVER-ONLY. Uses the service-role admin client (never exposed to the browser).
 */
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

export const Route = createFileRoute("/api/corpus")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: snapshot, error: snapshotErr } = await supabaseAdmin
            .from("corpus_snapshots")
            .select("id, snapshot_date")
            .eq("status", "active")
            .single();
          if (snapshotErr || !snapshot) {
            return json({ error: "No active corpus snapshot" }, { status: 404 });
          }

          const { data: versions } = await supabaseAdmin
            .from("framework_versions")
            .select("framework_id, version_label, frameworks(name)")
            .eq("snapshot_id", snapshot.id);

          return json({
            snapshot_date: snapshot.snapshot_date,
            frameworks: (versions ?? []).map((v) => ({
              id: v.framework_id,
              name: (v.frameworks as unknown as { name?: string } | null)?.name ?? v.framework_id,
              version_label: v.version_label,
            })),
          });
        } catch (err) {
          console.error("corpus endpoint failed:", err);
          const message = err instanceof Error ? err.message : String(err);
          return json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
