/**
 * Embedding seam (system design §4.3). Isolated behind this interface so we can
 * A/B two embedders against the golden set's retrieval-hit-rate and pick by
 * measurement, not brand. Embed CHILD chunks only (system design §5.3).
 *
 * SERVER-ONLY (and used by local ingestion scripts). Reads VOYAGE_API_KEY.
 *
 * IMPORTANT: the returned vector length MUST equal EMBEDDING.dim and match the
 * `vector(D)` column in the schema. A model change → a clean re-index.
 */
import { EMBEDDING, requireEnv } from "./config";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

export type EmbedInputType = "document" | "query";

/**
 * Embed one or more texts. Pass inputType "document" when embedding corpus chunks
 * and "query" when embedding a user sub-query (asymmetric retrieval).
 */
export async function embed(
  texts: string[],
  inputType: EmbedInputType = "document",
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const apiKey = requireEnv("VOYAGE_API_KEY");

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBEDDING.model,
      input: texts,
      input_type: inputType,
      output_dimension: EMBEDDING.dim,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Voyage embeddings error ${res.status}: ${detail.slice(0, 500)}`);
  }

  const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  const vectors = (data.data ?? []).map((d) => d.embedding);

  if (vectors.length !== texts.length) {
    throw new Error(`Embedding count mismatch: got ${vectors.length}, expected ${texts.length}`);
  }
  for (const v of vectors) {
    if (v.length !== EMBEDDING.dim) {
      throw new Error(
        `Embedding dim mismatch: got ${v.length}, expected ${EMBEDDING.dim}. ` +
          `Align EMBEDDING.dim and the vector(D) column.`,
      );
    }
  }
  return vectors;
}

/** Convenience: embed a single query. */
export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embed([text], "query");
  return v;
}
