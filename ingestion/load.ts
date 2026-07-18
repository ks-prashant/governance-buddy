/**
 * Load parsed framework(s) into Supabase (build plan §B step 4 + §E step 2 + promote).
 *
 * Runs OFFLINE and LOCALLY (not in the deployed Cloudflare Worker, which has no
 * filesystem and a bundle-size limit). Connects to Supabase over HTTPS with the
 * service-role key (bypasses RLS), embeds child chunks via Voyage, writes parents +
 * chunks under a new immutable snapshot, then promotes that snapshot to active.
 *
 * Two entry points:
 *   - loadFramework(parsed)      — one framework → its own new snapshot (Phase B).
 *   - loadFrameworks(parsed[])   — ALL frameworks → ONE combined snapshot (Phase E).
 *     Phase E needs a single five-framework snapshot; loading each framework separately
 *     would create five snapshots, each archiving the last, leaving only the final one
 *     active. Parent citation_label → id maps are built PER FRAMEWORK so a label reused
 *     across frameworks (GDPR "Art. 5" vs EU AI Act "Art. 5") never mis-links children.
 *
 * Secrets come from process.env (bun auto-loads .env / .env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { embed } from "../src/server/pipeline/embed";
import { EMBEDDING, requireEnv } from "../src/server/pipeline/config";
import type { ParsedFramework } from "./types";

/** pgvector accepts its text form "[a,b,c]"; PostgREST casts the string to vector. */
function toVector(v: number[]): string {
  return `[${v.join(",")}]`;
}

function batches<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function adminClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Create a new immutable snapshot (status 'building') and return its id. */
async function createSnapshot(db: SupabaseClient): Promise<string> {
  const snapshot_date = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from("corpus_snapshots")
    .insert({ snapshot_date, status: "building" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`snapshot insert failed: ${error?.message}`);
  return data.id as string;
}

/** Promote a snapshot: archive whatever is currently active, then activate this one.
 *  The partial unique index (`one_active_snapshot_idx`) enforces a single active row. */
async function promote(db: SupabaseClient, snapshotId: string): Promise<void> {
  const { error: archErr } = await db
    .from("corpus_snapshots")
    .update({ status: "archived" })
    .eq("status", "active");
  if (archErr) throw new Error(`archive previous active failed: ${archErr.message}`);
  const { error: promoteErr } = await db
    .from("corpus_snapshots")
    .update({ status: "active" })
    .eq("id", snapshotId);
  if (promoteErr) throw new Error(`promote failed: ${promoteErr.message}`);
}

export interface FrameworkLoadCounts {
  framework_id: string;
  parents: number;
  chunks: number;
}

/** Insert one framework's version row + parents + embedded children into an EXISTING
 *  snapshot. Does NOT create or promote the snapshot — the caller owns snapshot lifecycle
 *  so multiple frameworks can share one. The parent label→id map is local to this call,
 *  so labels are only required unique WITHIN this framework (the DB's chunk uniqueness
 *  index is (snapshot_id, framework_id, citation_label) as of migration 0005). */
async function insertFramework(
  db: SupabaseClient,
  snapshotId: string,
  parsed: ParsedFramework,
): Promise<FrameworkLoadCounts> {
  // Framework version row.
  const { error: verErr } = await db.from("framework_versions").insert({
    framework_id: parsed.framework_id,
    snapshot_id: snapshotId,
    version_label: parsed.version_label,
    source_url: parsed.source_url,
  });
  if (verErr) throw new Error(`framework_versions insert failed (${parsed.framework_id}): ${verErr.message}`);

  // Defense in depth: ingestion/validate.ts is the primary gate for parent-label
  // uniqueness, but load.ts shouldn't blindly trust it was run first — a duplicate parent
  // label WITHIN this framework would silently link children to the WRONG parent (the
  // later insert's id overwrites the earlier one in labelToId) with no error anywhere.
  const parentLabelCounts = new Map<string, number>();
  for (const p of parsed.parents) {
    parentLabelCounts.set(p.citation_label, (parentLabelCounts.get(p.citation_label) ?? 0) + 1);
  }
  const dupes = [...parentLabelCounts.entries()].filter(([, n]) => n > 1);
  if (dupes.length > 0) {
    throw new Error(
      `Duplicate parent citation_label(s) in ${parsed.framework_id}, refusing to load ` +
        `(would silently mis-link children): ${dupes.map(([label]) => label).join(", ")}`,
    );
  }

  const parentRows = parsed.parents.map((p) => ({
    snapshot_id: snapshotId,
    framework_id: parsed.framework_id,
    hierarchy_path: p.hierarchy_path,
    citation_label: p.citation_label,
    text: p.text,
    source_url: p.source_url ?? parsed.source_url,
    page_from: p.page_from ?? null,
    page_to: p.page_to ?? null,
  }));
  const labelToId = new Map<string, string>();
  for (const batch of batches(parentRows, 200)) {
    const { data, error } = await db.from("parents").insert(batch).select("id, citation_label");
    if (error || !data) throw new Error(`parents insert failed (${parsed.framework_id}): ${error?.message}`);
    for (const row of data) labelToId.set(row.citation_label as string, row.id as string);
  }

  // Children — embed (batched) then insert as chunks with their parent_id.
  const flat = parsed.parents.flatMap((p) =>
    p.children.map((c) => ({ child: c, parentLabel: p.citation_label })),
  );
  let chunkCount = 0;
  for (const group of batches(flat, EMBEDDING.batchSize)) {
    const vectors = await embed(group.map((g) => g.child.text), EMBEDDING.documentInputType);
    const rows = group.map((g, i) => {
      const parent_id = labelToId.get(g.parentLabel);
      if (!parent_id) throw new Error(`no parent id for ${parsed.framework_id} ${g.parentLabel}`);
      return {
        parent_id,
        snapshot_id: snapshotId,
        framework_id: parsed.framework_id,
        hierarchy_path: g.child.hierarchy_path,
        citation_label: g.child.citation_label,
        text: g.child.text,
        embedding: toVector(vectors[i]),
        embedding_model_id: EMBEDDING.model,
      };
    });
    const { error } = await db.from("chunks").insert(rows);
    if (error) throw new Error(`chunks insert failed (${parsed.framework_id}): ${error.message}`);
    chunkCount += rows.length;
  }

  return { framework_id: parsed.framework_id, parents: parentRows.length, chunks: chunkCount };
}

export interface LoadResult {
  snapshot_id: string;
  parents: number;
  chunks: number;
  per_framework: FrameworkLoadCounts[];
}

/** Load a single framework into its own new snapshot, then promote (Phase B). */
export async function loadFramework(parsed: ParsedFramework): Promise<LoadResult> {
  return loadFrameworks([parsed]);
}

/** Load ALL given frameworks into ONE new snapshot, then promote once (Phase E). */
export async function loadFrameworks(parsedList: ParsedFramework[]): Promise<LoadResult> {
  if (parsedList.length === 0) throw new Error("loadFrameworks: no frameworks given");
  const db = adminClient();

  const snapshot_id = await createSnapshot(db);
  const per_framework: FrameworkLoadCounts[] = [];
  for (const parsed of parsedList) {
    const counts = await insertFramework(db, snapshot_id, parsed);
    per_framework.push(counts);
  }
  await promote(db, snapshot_id);

  return {
    snapshot_id,
    parents: per_framework.reduce((n, f) => n + f.parents, 0),
    chunks: per_framework.reduce((n, f) => n + f.chunks, 0),
    per_framework,
  };
}
