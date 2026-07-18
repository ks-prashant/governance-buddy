/**
 * Load a parsed framework into Supabase (build plan §B step 4 + promote).
 *
 * Runs OFFLINE and LOCALLY (not in the deployed Cloudflare Worker, which has no
 * filesystem and a bundle-size limit). Connects to Supabase over HTTPS with the
 * service-role key (bypasses RLS), embeds child chunks via Voyage, writes parents +
 * chunks under a new immutable snapshot, then promotes that snapshot to active.
 *
 * Secrets come from process.env (bun auto-loads .env / .env.local):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VOYAGE_API_KEY.
 */
import { createClient } from "@supabase/supabase-js";
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

export interface LoadResult {
  snapshot_id: string;
  parents: number;
  chunks: number;
}

export async function loadFramework(parsed: ParsedFramework): Promise<LoadResult> {
  const db = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. New (immutable) snapshot, initially 'building'.
  const snapshot_date = new Date().toISOString().slice(0, 10);
  const { data: snap, error: snapErr } = await db
    .from("corpus_snapshots")
    .insert({ snapshot_date, status: "building" })
    .select("id")
    .single();
  if (snapErr || !snap) throw new Error(`snapshot insert failed: ${snapErr?.message}`);
  const snapshot_id = snap.id as string;

  // 2. Framework version row.
  const { error: verErr } = await db.from("framework_versions").insert({
    framework_id: parsed.framework_id,
    snapshot_id,
    version_label: parsed.version_label,
    source_url: parsed.source_url,
  });
  if (verErr) throw new Error(`framework_versions insert failed: ${verErr.message}`);

  // 3. Parents — insert in batches, capturing ids keyed by (unique) citation_label.
  // Defense in depth: ingestion/validate.ts is the primary gate for this invariant,
  // but load.ts shouldn't blindly trust it was run first — a duplicate parent label
  // would otherwise silently link children to the WRONG parent (the later insert's id
  // overwrites the earlier one in labelToId) with no error anywhere.
  const parentLabelCounts = new Map<string, number>();
  for (const p of parsed.parents) {
    parentLabelCounts.set(p.citation_label, (parentLabelCounts.get(p.citation_label) ?? 0) + 1);
  }
  const duplicateParentLabels = [...parentLabelCounts.entries()].filter(([, n]) => n > 1);
  if (duplicateParentLabels.length > 0) {
    throw new Error(
      `Duplicate parent citation_label(s), refusing to load (would silently mis-link ` +
        `children): ${duplicateParentLabels.map(([label]) => label).join(", ")}`,
    );
  }

  const parentRows = parsed.parents.map((p) => ({
    snapshot_id,
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
    if (error || !data) throw new Error(`parents insert failed: ${error?.message}`);
    for (const row of data) labelToId.set(row.citation_label as string, row.id as string);
  }

  // 4. Children — embed (batched) then insert as chunks with their parent_id.
  const flat = parsed.parents.flatMap((p) =>
    p.children.map((c) => ({ child: c, parentLabel: p.citation_label })),
  );
  let chunkCount = 0;
  for (const group of batches(flat, EMBEDDING.batchSize)) {
    const vectors = await embed(group.map((g) => g.child.text), EMBEDDING.documentInputType);
    const rows = group.map((g, i) => {
      const parent_id = labelToId.get(g.parentLabel);
      if (!parent_id) throw new Error(`no parent id for ${g.parentLabel}`);
      return {
        parent_id,
        snapshot_id,
        framework_id: parsed.framework_id,
        hierarchy_path: g.child.hierarchy_path,
        citation_label: g.child.citation_label,
        text: g.child.text,
        embedding: toVector(vectors[i]),
        embedding_model_id: EMBEDDING.model,
      };
    });
    const { error } = await db.from("chunks").insert(rows);
    if (error) throw new Error(`chunks insert failed: ${error.message}`);
    chunkCount += rows.length;
  }

  // 5. Promote — archive the previous active snapshot, then activate this one.
  //    (The partial unique index enforces a single active snapshot.)
  const { error: archErr } = await db
    .from("corpus_snapshots")
    .update({ status: "archived" })
    .eq("status", "active");
  if (archErr) throw new Error(`archive previous active failed: ${archErr.message}`);
  const { error: promoteErr } = await db
    .from("corpus_snapshots")
    .update({ status: "active" })
    .eq("id", snapshot_id);
  if (promoteErr) throw new Error(`promote failed: ${promoteErr.message}`);

  return { snapshot_id, parents: parentRows.length, chunks: chunkCount };
}
