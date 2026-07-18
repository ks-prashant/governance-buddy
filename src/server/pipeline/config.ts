/**
 * Central pipeline configuration — the single place to tune models, weights, and
 * retrieval parameters. Everything downstream reads from here so we can A/B models
 * and re-tune against the golden set (evals/) without touching pipeline logic.
 *
 * SERVER-ONLY. This module reads secret env vars and must never be imported into
 * client/browser code. All model calls go through the TanStack server layer.
 *
 * Build-plan reference: §A.5 (config baseline). System design: §4.4 (routed models).
 */

/** Model IDs, routed by stage difficulty (system design §4.4). */
export const MODELS = {
  /** Classify input · sufficiency check · query decomposition — cheap, fast, on the critical path. */
  classify: process.env.MODEL_CLASSIFY ?? "claude-haiku-4-5",
  /** Grounded generation (the obligation map) — the quality-critical synthesis step.
   *  ⚠️ TEMPORARY (2026-07-18, cost measure) — default switched from "claude-opus-4-8"
   *  to "claude-sonnet-5" so the Phase D eval fits a ~$5 API budget (Opus is ~5× the
   *  output price and generation is the dominant eval cost). REVERT to "claude-opus-4-8"
   *  before the launch/final eval — the gate must certify the model that actually ships.
   *  Tracked in docs/BUILD_PLAN.md §0 (session log) + §D. */
  generate: process.env.MODEL_GENERATE ?? "claude-sonnet-5",
  /** Citation validation (claim ⊢ cited chunk) — a constrained entailment check. */
  validate: process.env.MODEL_VALIDATE ?? "claude-haiku-4-5",
  /** Follow-up answers — same grounding rules; Sonnet 5 is the cost-down lever if volume grows. */
  followup: process.env.MODEL_FOLLOWUP ?? "claude-opus-4-8",
} as const;

/** Grounded-generation call settings (system design §7.1, §8.2). */
export const GENERATION = {
  /** Adaptive thinking effort for the map step. */
  effort: (process.env.GENERATION_EFFORT ?? "high") as "low" | "medium" | "high",
  maxTokens: Number(process.env.GENERATION_MAX_TOKENS ?? 8000),
  /**
   * Whether to prompt-cache the stable system prefix (system design §8.2 — the single
   * biggest cost lever). NEVER interpolate user text or the snapshot date into the
   * cached prefix, or prefix-match invalidates every call.
   */
  cacheSystemPrefix: (process.env.GENERATION_CACHE_PREFIX ?? "true") === "true",
} as const;

/**
 * Embedding model + dimension. The vector column width in the schema migration MUST
 * match `dim` exactly (system design §4.3) — a model change forces a clean re-index,
 * never a mixed vector space. Keep model id + dim in chunk metadata.
 *
 * [verify at build] Confirm the current Voyage model name and its dimension, then set
 * both here and in the `vector(D)` column of supabase/migrations/0001_schema.sql.
 */
export const EMBEDDING = {
  provider: "voyage" as const,
  model: process.env.EMBEDDING_MODEL ?? "voyage-3-large",
  dim: Number(process.env.EMBEDDING_DIM ?? 1024),
  /** Voyage input_type improves asymmetric retrieval quality. */
  documentInputType: "document" as const,
  queryInputType: "query" as const,
  /** Batch size for embedding child chunks during ingestion. */
  batchSize: Number(process.env.EMBEDDING_BATCH_SIZE ?? 128),
} as const;

/** Reranker settings (system design §6.4). A dedicated cross-encoder, not an LLM. */
export const RERANK = {
  provider: (process.env.RERANK_PROVIDER ?? "voyage") as "voyage" | "cohere",
  model: process.env.RERANK_MODEL ?? "rerank-2.5",
  /** How many reranked survivors to expand to parents and hand to generation. */
  topN: Number(process.env.RERANK_TOP_N ?? 12),
} as const;

/** Hybrid retrieval parameters (system design §6.2). */
export const RETRIEVAL = {
  /** Top-k children fetched per sub-query, per retrieval mode (dense / keyword). */
  topKPerSubquery: Number(process.env.RETRIEVAL_TOP_K ?? 20),
  /** Reciprocal Rank Fusion constant. */
  rrfK: Number(process.env.RETRIEVAL_RRF_K ?? 60),
  /**
   * Minimum reranker score for a candidate to be considered relevant at all.
   * WIRED (Phase D): pipeline.ts's refusal gate checks the max rerankScore across
   * all survivors (including citation-pinned matches, which always score 1) against
   * this floor before attempting generation — the honest "nothing clearly applies" /
   * refusal path (system design §7.3, §15). Tune against the golden set.
   */
  relevanceFloor: Number(process.env.RETRIEVAL_RELEVANCE_FLOOR ?? 0.3),
} as const;

/**
 * Rate limiting / cost caps on the generation endpoint (build plan §I step 2). Checked
 * against the `generation_requests` table BEFORE the expensive pipeline runs — a
 * session or IP over its window is refused with 429, never a partial/degraded answer.
 */
export const RATE_LIMIT = {
  /** Max /api/generate attempts from one session_id within sessionWindowMinutes. */
  perSessionMax: Number(process.env.RATE_LIMIT_SESSION_MAX ?? 8),
  sessionWindowMinutes: Number(process.env.RATE_LIMIT_SESSION_WINDOW_MIN ?? 10),
  /** Max /api/generate attempts from one IP within ipWindowMinutes (covers many
   *  sessions behind one NAT/office network, so it's deliberately looser). */
  perIpMax: Number(process.env.RATE_LIMIT_IP_MAX ?? 30),
  ipWindowMinutes: Number(process.env.RATE_LIMIT_IP_WINDOW_MIN ?? 60),
} as const;

/**
 * Priority-tier weights (system design §7.4, PRD §15 — left to tuning).
 * tier_score = w1·applicability + w2·impact + w3·retrieval_confidence.
 * Start near-equal; tune against the golden set. Tiers are computed in app code,
 * never asked of the model.
 */
export const TIER_WEIGHTS = {
  w1: Number(process.env.TIER_W1 ?? 0.4), // applicability strength
  w2: Number(process.env.TIER_W2 ?? 0.35), // obligation impact
  w3: Number(process.env.TIER_W3 ?? 0.25), // retrieval confidence
} as const;

/** Numeric strength for each applicability label (system design §7.4). */
export const APPLICABILITY_STRENGTH = {
  Direct: 1.0,
  Inferred: 0.6,
  Possible: 0.3,
} as const;

/** Tier thresholds on the normalized tier_score. Tune against the golden set. */
export const TIER_THRESHOLDS = {
  /** ≥ this → "Applies — act on these". */
  applies: Number(process.env.TIER_THRESHOLD_APPLIES ?? 0.66),
  /** ≥ this (and < applies) → "Likely relevant — review"; below → "Possibly relevant". */
  likely: Number(process.env.TIER_THRESHOLD_LIKELY ?? 0.4),
} as const;

/** Secret accessors — throw a clear error at call time if a key is missing. */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required secret env var: ${name}. Set it in Lovable Cloud secrets ` +
        `(and a git-ignored local .env for ingestion scripts). See .env.example.`,
    );
  }
  return v;
}

export type ApplicabilityLabel = keyof typeof APPLICABILITY_STRENGTH;
export type ImpactLabel = "high" | "medium" | "low";
