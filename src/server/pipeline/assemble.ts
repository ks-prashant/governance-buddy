/**
 * Assembly (system design §7.4, §8; build plan §D step 3).
 *
 * Turns validated obligations into the final result: priority tiers computed by a
 * transparent formula (NOT asked of the model), citation chips + source-viewer payloads
 * built from TRUSTED chunk metadata (never model text — principle #3), plus the
 * decision-support framing and corpus date. Also renders the flat `text` / `citations`
 * / `retrievedContext` shape the eval harness grades against.
 */
import {
  TIER_WEIGHTS,
  TIER_THRESHOLDS,
  APPLICABILITY_STRENGTH,
  type ApplicabilityLabel,
  type ImpactLabel,
} from "./config";
import type { ValidatedObligation } from "./validate";

const IMPACT_WEIGHT: Record<ImpactLabel, number> = { high: 1, medium: 0.6, low: 0.3 };

export type Tier = "applies" | "likely" | "possibly";

export interface Citation {
  chunk_id: string;
  framework: string;
  citation_label: string;
  hierarchy_path: string[];
  source_url: string | null;
}

export interface AssembledObligation {
  statement: string;
  rationale: string;
  applicability: ApplicabilityLabel;
  impact: ImpactLabel;
  tier: Tier;
  tier_score: number;
  citations: Citation[];
  conflicts_with?: Citation;
}

export interface ChunkMeta {
  framework: string;
  citation_label: string;
  hierarchy_path: string[];
  source_url: string | null;
}

export interface AssembleInput {
  restatedUnderstanding?: string;
  obligations: ValidatedObligation[];
  gaps: string[];
  overallConfidence: "high" | "medium" | "low";
  chunkMeta: Map<string, ChunkMeta>;
  /** Normalized reranker score per chunk_id, for the retrieval-confidence term. */
  rerankScore: Map<string, number>;
  snapshotDate: string;
  retrievedContext: string;
}

export interface AssembledResult {
  restated_understanding?: string;
  tiers: { applies: AssembledObligation[]; likely: AssembledObligation[]; possibly: AssembledObligation[] };
  gaps: string[];
  overall_confidence: "high" | "medium" | "low";
  framing: string;
  corpus_as_of: string;
  /** Flat views the eval harness consumes. */
  text: string;
  citations: Array<{ framework: string; anchor: string }>;
  retrievedContext: string;
}

const FRAMING = "Decision support, not legal advice.";

function tierScore(o: ValidatedObligation, rerankScore: Map<string, number>): number {
  const applicability = APPLICABILITY_STRENGTH[o.applicability];
  const impact = IMPACT_WEIGHT[o.impact];
  const conf =
    Math.max(0, ...o.supporting_chunk_ids.map((id) => rerankScore.get(id) ?? 0)) || 0;
  return TIER_WEIGHTS.w1 * applicability + TIER_WEIGHTS.w2 * impact + TIER_WEIGHTS.w3 * conf;
}

function tierFor(score: number): Tier {
  if (score >= TIER_THRESHOLDS.applies) return "applies";
  if (score >= TIER_THRESHOLDS.likely) return "likely";
  return "possibly";
}

function citationsFor(ids: string[], chunkMeta: Map<string, ChunkMeta>): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const id of ids) {
    const m = chunkMeta.get(id);
    if (!m || seen.has(id)) continue;
    seen.add(id);
    out.push({
      chunk_id: id,
      framework: m.framework,
      citation_label: m.citation_label,
      hierarchy_path: m.hierarchy_path,
      source_url: m.source_url,
    });
  }
  return out;
}

export function assemble(input: AssembleInput): AssembledResult {
  const assembled: AssembledObligation[] = input.obligations.map((o) => {
    const score = tierScore(o, input.rerankScore);
    const conflictMeta = o.conflicts_with ? input.chunkMeta.get(o.conflicts_with) : undefined;
    return {
      statement: o.statement,
      rationale: o.rationale,
      applicability: o.applicability,
      impact: o.impact,
      tier: tierFor(score),
      tier_score: Number(score.toFixed(4)),
      citations: citationsFor(o.supporting_chunk_ids, input.chunkMeta),
      conflicts_with:
        o.conflicts_with && conflictMeta
          ? {
              chunk_id: o.conflicts_with,
              framework: conflictMeta.framework,
              citation_label: conflictMeta.citation_label,
              hierarchy_path: conflictMeta.hierarchy_path,
              source_url: conflictMeta.source_url,
            }
          : undefined,
    };
  });

  const byTier = (t: Tier) =>
    assembled.filter((o) => o.tier === t).sort((a, b) => b.tier_score - a.tier_score);
  const tiers = { applies: byTier("applies"), likely: byTier("likely"), possibly: byTier("possibly") };

  // Flat citation list (deduped by framework+label) for the eval harness.
  const citeSeen = new Set<string>();
  const citations: Array<{ framework: string; anchor: string }> = [];
  for (const o of assembled) {
    for (const c of o.citations) {
      const key = `${c.framework}::${c.citation_label}`;
      if (citeSeen.has(key)) continue;
      citeSeen.add(key);
      citations.push({ framework: c.framework, anchor: c.citation_label });
    }
  }

  return {
    restated_understanding: input.restatedUnderstanding,
    tiers,
    gaps: input.gaps,
    overall_confidence: input.overallConfidence,
    framing: FRAMING,
    corpus_as_of: input.snapshotDate,
    text: renderText({ ...input, assembled, tiers }),
    citations,
    retrievedContext: input.retrievedContext,
  };
}

const TIER_HEADINGS: Record<Tier, string> = {
  applies: "Applies — act on these",
  likely: "Likely relevant — review",
  possibly: "Possibly relevant",
};

function renderText(args: {
  restatedUnderstanding?: string;
  gaps: string[];
  overallConfidence: string;
  snapshotDate: string;
  assembled: AssembledObligation[];
  tiers: AssembledResult["tiers"];
}): string {
  const lines: string[] = [];
  if (args.restatedUnderstanding) lines.push(`Understood: ${args.restatedUnderstanding}`, "");

  for (const tier of ["applies", "likely", "possibly"] as const) {
    const items = args.tiers[tier];
    if (items.length === 0) continue;
    lines.push(`## ${TIER_HEADINGS[tier]}`);
    for (const o of items) {
      const cites = o.citations.map((c) => `${c.framework} ${c.citation_label}`).join("; ");
      lines.push(`- ${o.statement} [${o.applicability}] (${cites})`);
      if (o.rationale) lines.push(`  Why: ${o.rationale}`);
      if (o.conflicts_with) {
        lines.push(
          `  Conflicts with ${o.conflicts_with.framework} ${o.conflicts_with.citation_label} — these pull in different directions.`,
        );
      }
    }
    lines.push("");
  }

  if (args.gaps.length) {
    lines.push("## Not clearly addressed by the current corpus");
    for (const g of args.gaps) lines.push(`- ${g}`);
    lines.push("");
  }

  lines.push(`${FRAMING} · Corpus as of ${args.snapshotDate}.`);
  return lines.join("\n");
}
