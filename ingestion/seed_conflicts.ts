/**
 * Seed the curated cross-framework `conflicts` table (build plan §E step 4, system
 * design §7.3). These are the well-documented tensions from the golden set (CONF-01..04):
 * pairs of clauses from different frameworks that pull in opposite directions and must be
 * shown PAIRED and UNRESOLVED, never reconciled. This is the durable, curated backstop that
 * complements the model's own per-response `conflicts_with` flag (already wired in
 * generate.ts → assemble.ts).
 *
 * Runs AFTER a snapshot is loaded (it resolves each clause to a chunk_id in the active
 * snapshot) and needs the service-role key — same offline/Lovable-sandbox path as load.ts.
 *   bun ingestion/seed_conflicts.ts
 *
 * Idempotent: clears this snapshot's conflicts first, then re-inserts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "../src/server/pipeline/config";

/** Curated tensions. Each side is (framework_id, an article-level anchor); the note is the
 *  plain-language description of why they pull apart. Kept in sync with evals CONF-01..04. */
const CONFLICTS: Array<{
  id: string;
  a: { framework_id: string; anchor: string };
  b: { framework_id: string; anchor: string };
  note: string;
}> = [
  {
    id: "CONF-01",
    a: { framework_id: "gdpr", anchor: "Article 5(1)(c)" },
    b: { framework_id: "eu_ai_act", anchor: "Article 10(5)" },
    note: "Data minimisation (collect the least personal data necessary) pulls against bias/quality testing, for which the EU AI Act permits processing special-category data. Both apply — neither overrides the other.",
  },
  {
    id: "CONF-02",
    a: { framework_id: "gdpr", anchor: "Article 5(1)(e)" },
    b: { framework_id: "eu_ai_act", anchor: "Article 12" },
    note: "Storage limitation (delete data no longer needed) pulls against the automatic record-keeping/logging obligations for high-risk AI systems.",
  },
  {
    id: "CONF-03",
    a: { framework_id: "gdpr", anchor: "Article 15(1)(h)" },
    b: { framework_id: "eu_ai_act", anchor: "Article 15(5)" },
    note: "The right to meaningful information about automated decisions pulls against protecting the system's robustness/security and confidential IP — a tension NIST AI RMF §3.4 names explicitly.",
  },
  {
    id: "CONF-04",
    a: { framework_id: "eu_ai_act", anchor: "Article 14" },
    b: { framework_id: "gdpr", anchor: "Article 32(1)" },
    note: "Human oversight broadens who may access applicant data, pulling against access minimisation and security-of-processing.",
  },
];

function adminClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolve an "Article N(M)(x)" anchor to a chunk_id in the snapshot for the given
 *  framework. Point-level anchors reduce to their paragraph chunk ("Art. N(M)"); an
 *  article-level anchor with no exact paragraph chunk falls back to the article's first
 *  numbered paragraph. */
async function resolveChunkId(
  db: SupabaseClient,
  snapshotId: string,
  framework_id: string,
  anchor: string,
): Promise<string | null> {
  const m = /^Article\s+(\d+)(?:\((\d+)\))?/.exec(anchor);
  const label = m ? (m[2] ? `Art. ${m[1]}(${m[2]})` : `Art. ${m[1]}`) : anchor;

  const exact = await db
    .from("chunks")
    .select("id")
    .eq("snapshot_id", snapshotId)
    .eq("framework_id", framework_id)
    .eq("citation_label", label)
    .limit(1);
  if (exact.error) throw new Error(`chunk lookup failed for ${framework_id} ${label}: ${exact.error.message}`);
  if (exact.data?.length) return exact.data[0].id as string;

  // Fallback: an article-level anchor → its first paragraph ("Art. N(1)", "Art. N(2)"…).
  if (m && !m[2]) {
    const fam = await db
      .from("chunks")
      .select("id, citation_label")
      .eq("snapshot_id", snapshotId)
      .eq("framework_id", framework_id)
      .ilike("citation_label", `Art. ${m[1]}(%`)
      .order("citation_label", { ascending: true })
      .limit(1);
    if (fam.error) throw new Error(`chunk family lookup failed for ${framework_id} ${label}: ${fam.error.message}`);
    if (fam.data?.length) return fam.data[0].id as string;
  }
  return null;
}

async function main() {
  const db = adminClient();

  const snap = await db.from("corpus_snapshots").select("id").eq("status", "active").single();
  if (snap.error || !snap.data) throw new Error(`no active snapshot: ${snap.error?.message ?? "none"}`);
  const snapshotId = snap.data.id as string;
  console.log(`Seeding conflicts into active snapshot ${snapshotId.slice(0, 8)}…`);

  // Idempotent: clear this snapshot's conflicts first.
  const del = await db.from("conflicts").delete().eq("snapshot_id", snapshotId);
  if (del.error) throw new Error(`clearing existing conflicts failed: ${del.error.message}`);

  const rows: Array<{ snapshot_id: string; chunk_id_a: string; chunk_id_b: string; note: string }> = [];
  for (const c of CONFLICTS) {
    const [a, b] = await Promise.all([
      resolveChunkId(db, snapshotId, c.a.framework_id, c.a.anchor),
      resolveChunkId(db, snapshotId, c.b.framework_id, c.b.anchor),
    ]);
    if (!a || !b) {
      console.warn(
        `  ⚠ ${c.id}: could not resolve ${!a ? `${c.a.framework_id} ${c.a.anchor}` : ""}` +
          `${!a && !b ? " and " : ""}${!b ? `${c.b.framework_id} ${c.b.anchor}` : ""} — skipped`,
      );
      continue;
    }
    rows.push({ snapshot_id: snapshotId, chunk_id_a: a, chunk_id_b: b, note: c.note });
    console.log(`  ✓ ${c.id}: ${c.a.framework_id} ${c.a.anchor} ⟷ ${c.b.framework_id} ${c.b.anchor}`);
  }

  if (rows.length === 0) {
    console.error("No conflicts resolved — is the five-framework snapshot loaded and active?");
    process.exit(1);
  }
  const ins = await db.from("conflicts").insert(rows);
  if (ins.error) throw new Error(`conflicts insert failed: ${ins.error.message}`);
  console.log(`✓ seeded ${rows.length}/${CONFLICTS.length} conflicts`);
}

main().catch((e) => {
  console.error("Conflict seeding failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
