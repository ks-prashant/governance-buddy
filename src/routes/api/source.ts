/**
 * Source-viewer endpoint (build plan §F, design guidelines §5.8) — resolves a single
 * chunk_id (as returned in an obligation's citations, system design §7.1 "the citation
 * chip and source-viewer payload are built from trusted data") to the exact paragraph
 * text, its surrounding parent context, full hierarchy, framework version, and the
 * corpus snapshot date it was answered against.
 *
 * Citation payloads sent to the browser (assemble.ts's `Citation`) intentionally omit
 * chunk text — this endpoint is the one place that text is fetched, on demand, when a
 * user actually opens a citation. Trusted metadata only; nothing here is model-authored.
 *
 * SERVER-ONLY. Uses the service-role admin client (never exposed to the browser).
 */
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

export const Route = createFileRoute("/api/source")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const chunkId = new URL(request.url).searchParams.get("chunk_id");
        if (!chunkId) {
          return json({ error: "Missing required query param: chunk_id" }, { status: 400 });
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const { data: chunk, error: chunkErr } = await supabaseAdmin
            .from("chunks")
            .select(
              "id, parent_id, framework_id, snapshot_id, hierarchy_path, citation_label, text",
            )
            .eq("id", chunkId)
            .single();
          if (chunkErr || !chunk) {
            return json({ error: "Unknown chunk_id" }, { status: 404 });
          }

          const [{ data: parent }, { data: framework }, { data: version }, { data: snapshot }] =
            await Promise.all([
              supabaseAdmin
                .from("parents")
                .select("citation_label, hierarchy_path, text, source_url")
                .eq("id", chunk.parent_id)
                .single(),
              supabaseAdmin.from("frameworks").select("name").eq("id", chunk.framework_id).single(),
              supabaseAdmin
                .from("framework_versions")
                .select("version_label, source_url")
                .eq("framework_id", chunk.framework_id)
                .eq("snapshot_id", chunk.snapshot_id)
                .maybeSingle(),
              supabaseAdmin
                .from("corpus_snapshots")
                .select("snapshot_date")
                .eq("id", chunk.snapshot_id)
                .single(),
            ]);

          return json({
            chunk_id: chunk.id,
            framework: (framework?.name as string) ?? chunk.framework_id,
            citation_label: chunk.citation_label,
            hierarchy_path: chunk.hierarchy_path,
            chunk_text: chunk.text,
            parent_citation_label: parent?.citation_label ?? chunk.citation_label,
            parent_text: parent?.text ?? chunk.text,
            source_url: parent?.source_url ?? version?.source_url ?? null,
            version_label: version?.version_label ?? null,
            snapshot_date: (snapshot?.snapshot_date as string) ?? null,
          });
        } catch (err) {
          console.error("source endpoint failed:", err);
          const message = err instanceof Error ? err.message : String(err);
          return json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
