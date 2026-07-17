/**
 * Rerank seam (system design §6.4). A dedicated cross-encoder reranker scores true
 * query↔clause relevance on the fused candidate pool, restoring precision before
 * generation (which directly lifts groundedness). Kept behind this interface so the
 * reranker is swappable and can fall back to keyword-only retrieval on outage (§15).
 *
 * SERVER-ONLY. Reads VOYAGE_API_KEY (or the configured provider's key).
 */
import { RERANK, requireEnv } from "./config";

const VOYAGE_RERANK_URL = "https://api.voyageai.com/v1/rerank";

export interface RerankInput {
  /** Stable id so callers can map results back to their chunk. */
  id: string;
  text: string;
}

export interface RerankResult {
  id: string;
  text: string;
  score: number;
  index: number;
}

/**
 * Rerank `docs` against `query`, returning them ordered best-first with scores.
 * `query` should be the ORIGINAL user description, not a sub-query (system design §6.4).
 */
export async function rerank(query: string, docs: RerankInput[]): Promise<RerankResult[]> {
  if (docs.length === 0) return [];

  if (RERANK.provider !== "voyage") {
    throw new Error(`Rerank provider "${RERANK.provider}" not yet wired. Add it here.`);
  }
  const apiKey = requireEnv("VOYAGE_API_KEY");

  const res = await fetch(VOYAGE_RERANK_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: RERANK.model,
      query,
      documents: docs.map((d) => d.text),
      top_k: Math.min(RERANK.topN, docs.length),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Voyage rerank error ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    data?: Array<{ index: number; relevance_score: number }>;
  };

  return (data.data ?? []).map((r) => ({
    id: docs[r.index].id,
    text: docs[r.index].text,
    score: r.relevance_score,
    index: r.index,
  }));
}
