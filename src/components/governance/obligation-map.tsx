/**
 * The Obligation Map (PRD §8.3, design guidelines §5.6) — three grouped priority
 * tiers, visual weight descending with priority, labeled in words (never color-only).
 * Streamed tier-by-tier from the SSE result in build; here the map arrives whole
 * (Phase D's `result` event carries the fully-assembled tiers), so tiers simply
 * render in priority order, "Applies" first.
 */
import type { AssembledResult, Citation, Tier } from "@/hooks/use-obligation-stream";
import { ObligationCard } from "./obligation-card";
import { ConflictSection } from "./conflict-section";

const TIER_ORDER: Tier[] = ["applies", "likely", "possibly"];

const TIER_META: Record<Tier, { heading: string; barClass: string }> = {
  applies: { heading: "Applies — act on these", barClass: "bg-tier-applies" },
  likely: { heading: "Likely relevant — review", barClass: "bg-tier-likely" },
  possibly: { heading: "Possibly relevant", barClass: "bg-tier-possibly" },
};

export function ObligationMap({
  result,
  onOpenSource,
}: {
  result: AssembledResult;
  onOpenSource: (citation: Citation) => void;
}) {
  const nonEmptyTiers = TIER_ORDER.filter((t) => result.tiers[t].length > 0);

  return (
    <div className="space-y-8">
      {result.overall_confidence === "low" && (
        <div className="rounded-lg border border-border bg-secondary/60 px-4 py-3 text-sm text-secondary-foreground">
          Overall retrieval confidence on this mapping is low — treat it as a starting point for
          review, not a finished answer.
        </div>
      )}

      {nonEmptyTiers.map((tier) => (
        <section key={tier} aria-label={TIER_META[tier].heading}>
          <div className="mb-3 flex items-center gap-2">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${TIER_META[tier].barClass}`} />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
              {TIER_META[tier].heading}
            </h2>
          </div>
          <div className="space-y-3">
            {result.tiers[tier].map((o, i) => (
              <ObligationCard key={`${tier}-${i}`} obligation={o} onOpenSource={onOpenSource} />
            ))}
          </div>
        </section>
      ))}

      <ConflictSection result={result} onOpenSource={onOpenSource} />

      {result.gaps.length > 0 && (
        <section aria-label="Gaps and uncertainty">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground">
            Not clearly addressed by the current corpus
          </h2>
          <div className="rounded-lg border border-dashed border-border bg-muted/40 p-4">
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
              {result.gaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
