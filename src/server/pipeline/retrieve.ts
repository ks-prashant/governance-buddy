/**
 * Hybrid retrieval (system design §6.2–§6.4, build plan §C).
 *
 * For each sub-query: dense (pgvector cosine) + keyword (Postgres FTS) search,
 * fused with Reciprocal Rank Fusion. Candidates are merged across all sub-queries
 * (max fused score wins per chunk), then handed to the reranker (rerank.ts) against
 * the ORIGINAL input text, and finally expanded to their parent articles.
 *
 * SERVER-ONLY. Takes a Supabase client so callers control which client (admin vs.
 * anon) is used; the retrieval endpoint uses the service-role admin client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { embed } from "./embed";
import { rerank, type RerankResult } from "./rerank";
import { RETRIEVAL, EMBEDDING } from "./config";
import type { QueryUnderstanding } from "./understand";

export interface ChunkCandidate {
  id: string;
  parent_id: string;
  framework_id: string;
  hierarchy_path: string[];
  citation_label: string;
  text: string;
}

export interface ScoredCandidate extends ChunkCandidate {
  /** Best fused RRF score seen for this chunk across all sub-queries. */
  fusedScore: number;
}

export interface RerankedCandidate extends ChunkCandidate {
  rerankScore: number;
}

export interface ParentGroup {
  parent_id: string;
  framework_id: string;
  hierarchy_path: string[];
  citation_label: string;
  text: string;
  source_url: string | null;
  /** Chunk ids that were retrieved under this parent, with their rerank scores. */
  supporting_chunks: Array<{ id: string; citation_label: string; rerankScore: number }>;
}

export async function getActiveSnapshotId(db: SupabaseClient): Promise<string> {
  const { data, error } = await db
    .from("corpus_snapshots")
    .select("id")
    .eq("status", "active")
    .single();
  if (error || !data) throw new Error(`No active snapshot: ${error?.message ?? "none found"}`);
  return data.id as string;
}

/** Reciprocal Rank Fusion over one or more ranked id lists (system design §6.2). */
function rrfFuse(rankedLists: string[][], k = RETRIEVAL.rrfK): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((id, idx) => {
      const rank = idx + 1;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    });
  }
  return scores;
}

async function searchOneSubquery(
  db: SupabaseClient,
  queryText: string,
  queryEmbedding: number[],
  opts: { snapshotId: string; frameworkId?: string },
): Promise<ScoredCandidate[]> {
  const topK = RETRIEVAL.topKPerSubquery;

  const [dense, keywordRes] = await Promise.all([
    db.rpc("match_chunks_dense", {
      query_embedding: `[${queryEmbedding.join(",")}]`,
      p_snapshot_id: opts.snapshotId,
      p_framework_id: opts.frameworkId ?? null,
      match_count: topK,
    }),
    db.rpc("match_chunks_keyword", {
      query_text: queryText,
      p_snapshot_id: opts.snapshotId,
      p_framework_id: opts.frameworkId ?? null,
      match_count: topK,
    }),
  ]);

  if (dense.error) throw new Error(`match_chunks_dense failed: ${dense.error.message}`);
  if (keywordRes.error) throw new Error(`match_chunks_keyword failed: ${keywordRes.error.message}`);

  const denseRows = (dense.data ?? []) as ChunkCandidate[];
  const keywordRows = (keywordRes.data ?? []) as ChunkCandidate[];

  const byId = new Map<string, ChunkCandidate>();
  for (const r of [...denseRows, ...keywordRows]) byId.set(r.id, r);

  const fused = rrfFuse([denseRows.map((r) => r.id), keywordRows.map((r) => r.id)]);

  return [...fused.entries()]
    .map(([id, fusedScore]) => ({ ...byId.get(id)!, fusedScore }))
    .sort((a, b) => b.fusedScore - a.fusedScore);
}

/** Run every sub-query, merging candidates by max fused score (dedup across subqueries).
 *
 * Always also searches the ORIGINAL raw input verbatim, not just the LLM's
 * paraphrased sub-queries. Paraphrasing can drop explicit identifiers (article
 * numbers, subcategory codes) that neither dense embedding nor keyword ranking
 * recovers once diluted into prose — e.g. "GDPR Article 99 requirements for AI
 * training data handling" doesn't surface Art. 99 because its actual text (entry
 * into force) shares no semantic content with "AI training data". Exact-citation
 * recall matters increasingly once EU AI Act/NIST identifier-style anchors are
 * added, so the raw input is a permanent extra query, not a one-off patch.
 *
 * All query texts are embedded in ONE batched Voyage call (not one call per query) —
 * measured live, per-query embedding was a meaningful share of the 5-9s Phase C
 * round-trip; embed() already accepts an array, so batching costs nothing. */
export async function retrieveCandidatePool(
  db: SupabaseClient,
  understanding: QueryUnderstanding,
  originalInput: string,
  opts: { snapshotId: string; frameworkId?: string },
): Promise<ScoredCandidate[]> {
  const queries = [originalInput, ...understanding.subqueries.map((sq) => sq.query)];
  const embeddings = await embed(queries, EMBEDDING.queryInputType);
  const perSubquery = await Promise.all(
    queries.map((q, i) => searchOneSubquery(db, q, embeddings[i], opts)),
  );

  const merged = new Map<string, ScoredCandidate>();
  for (const list of perSubquery) {
    for (const cand of list) {
      const existing = merged.get(cand.id);
      if (!existing || cand.fusedScore > existing.fusedScore) merged.set(cand.id, cand);
    }
  }
  return [...merged.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}

/** Rerank the candidate pool against the ORIGINAL input (system design §6.4). */
export async function rerankCandidates(
  originalInput: string,
  candidates: ScoredCandidate[],
): Promise<RerankedCandidate[]> {
  if (candidates.length === 0) return [];
  const results: RerankResult[] = await rerank(
    originalInput,
    candidates.map((c) => ({ id: c.id, text: c.text })),
  );
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return results
    .filter((r) => byId.has(r.id))
    .map((r): RerankedCandidate => {
      const cand = byId.get(r.id)!;
      return {
        id: cand.id,
        parent_id: cand.parent_id,
        framework_id: cand.framework_id,
        hierarchy_path: cand.hierarchy_path,
        citation_label: cand.citation_label,
        text: cand.text,
        rerankScore: r.score,
      };
    });
}

/** Expand reranked survivors to their parent articles, grouping children under
 *  their parent (system design §6.4, DR-8) — the unit handed to generation. */
export async function expandToParents(
  db: SupabaseClient,
  survivors: RerankedCandidate[],
): Promise<ParentGroup[]> {
  if (survivors.length === 0) return [];
  const parentIds = [...new Set(survivors.map((s) => s.parent_id))];
  const { data, error } = await db
    .from("parents")
    .select("id, framework_id, hierarchy_path, citation_label, text, source_url")
    .in("id", parentIds);
  if (error || !data) throw new Error(`parent expansion failed: ${error?.message}`);

  const byParentId = new Map(data.map((p) => [p.id as string, p]));
  const groups = new Map<string, ParentGroup>();
  for (const s of survivors) {
    const p = byParentId.get(s.parent_id);
    if (!p) continue;
    if (!groups.has(s.parent_id)) {
      groups.set(s.parent_id, {
        parent_id: s.parent_id,
        framework_id: p.framework_id as string,
        hierarchy_path: p.hierarchy_path as string[],
        citation_label: p.citation_label as string,
        text: p.text as string,
        source_url: (p.source_url as string) ?? null,
        supporting_chunks: [],
      });
    }
    groups.get(s.parent_id)!.supporting_chunks.push({
      id: s.id,
      citation_label: s.citation_label,
      rerankScore: s.rerankScore,
    });
  }
  return [...groups.values()].sort(
    (a, b) =>
      Math.max(...b.supporting_chunks.map((c) => c.rerankScore)) -
      Math.max(...a.supporting_chunks.map((c) => c.rerankScore)),
  );
}

/** Extract explicit citation references from raw input and turn them into
 *  citation_label ILIKE patterns. GDPR article form for now ("Article 22", "Art. 6(1)"
 *  → "Art. 22%", "Art. 6(1)%"); Phase E extends this for the other frameworks'
 *  identifier shapes (Annex III, PR.DS-01, MAP 1.1, PW.4.1). */
export function extractCitationPatterns(input: string): string[] {
  const patterns = new Set<string>();
  const re = /\bart(?:icle)?\.?\s*(\d+)\s*(?:\((\d+)\))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    const para = m[2] ? `(${m[2]})` : "";
    patterns.add(`Art. ${m[1]}${para}%`);
  }
  return [...patterns];
}

async function matchByCitation(
  db: SupabaseClient,
  patterns: string[],
  opts: { snapshotId: string; frameworkId?: string },
): Promise<ChunkCandidate[]> {
  const { data, error } = await db.rpc("match_chunks_by_citation", {
    patterns,
    p_snapshot_id: opts.snapshotId,
    p_framework_id: opts.frameworkId ?? null,
    match_count: RETRIEVAL.topKPerSubquery,
  });
  if (error) throw new Error(`match_chunks_by_citation failed: ${error.message}`);
  return (data ?? []) as ChunkCandidate[];
}

/** Full retrieval: dense+keyword pool → rerank → pin exact citation matches → expand.
 *
 * Chunks matched by an explicit citation the user named are PINNED (given a max
 * rerank score) so they survive even when their body text is unrelated to the rest
 * of the query — if a user asks about "Article 99", they get Article 99, regardless
 * of what Article 99 happens to be about. */
export async function runRetrieval(
  db: SupabaseClient,
  understanding: QueryUnderstanding,
  originalInput: string,
  opts: { snapshotId: string; frameworkId?: string },
): Promise<{ reranked: RerankedCandidate[]; parents: ParentGroup[]; timings: Record<string, number> }> {
  const timings: Record<string, number> = {};

  let t = Date.now();
  const pool = await retrieveCandidatePool(db, understanding, originalInput, opts);
  timings.pool_ms = Date.now() - t;

  t = Date.now();
  const reranked = await rerankCandidates(originalInput, pool);
  timings.rerank_ms = Date.now() - t;

  t = Date.now();
  const patterns = extractCitationPatterns(originalInput);
  let pinned: RerankedCandidate[] = [];
  if (patterns.length > 0) {
    const rows = await matchByCitation(db, patterns, opts);
    const seen = new Set(reranked.map((r) => r.id));
    pinned = rows
      .filter((r) => !seen.has(r.id))
      .map((r) => ({ ...r, rerankScore: 1 }));
  }
  timings.citation_pin_ms = Date.now() - t;

  t = Date.now();
  const survivors = [...pinned, ...reranked];
  const parents = await expandToParents(db, survivors);
  timings.expand_ms = Date.now() - t;

  timings.candidate_pool_size = pool.length;
  return { reranked: survivors, parents, timings };
}
