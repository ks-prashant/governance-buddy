/**
 * Conflict display (design guidelines §5.10, PRD §6.1 Step 6, §9) — a dedicated
 * section, separate from the priority tiers, showing conflicting obligations as
 * PAIRED cards under "These frameworks pull in different directions." Neutral
 * "tension" treatment, no resolution asserted, no winner/loser visual.
 *
 * The model flags a conflict as `conflicts_with: chunk_id` (system design §7.1) — the
 * opposing side is trusted citation metadata (framework/label/hierarchy), not
 * necessarily another full obligation already in the map. The right-hand card is
 * therefore a citation stub: framework + clause + hierarchy, openable in the source
 * viewer just like any other citation. This is what the data actually supports —
 * inventing a synthetic obligation statement for the other side would not be grounded.
 */
import type { AssembledObligation, Citation } from "@/hooks/use-obligation-stream";
import { ApplicabilityChip } from "./applicability-chip";
import { CitationChip } from "./citation-chip";

interface ConflictPair {
  obligation: AssembledObligation;
  opposing: Citation;
}

export function ConflictSection({
  result,
  onOpenSource,
}: {
  result: { tiers: { applies: AssembledObligation[]; likely: AssembledObligation[]; possibly: AssembledObligation[] } };
  onOpenSource: (citation: Citation) => void;
}) {
  const pairs: ConflictPair[] = [];
  for (const tier of ["applies", "likely", "possibly"] as const) {
    for (const o of result.tiers[tier]) {
      if (o.conflicts_with) pairs.push({ obligation: o, opposing: o.conflicts_with });
    }
  }
  if (pairs.length === 0) return null;

  return (
    <section aria-label="Framework conflicts">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-foreground">
        These frameworks pull in different directions
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Shown side by side, both cited, with no resolution asserted — a genuine tension in the
        sources, not an error.
      </p>
      <div className="space-y-4">
        {pairs.map((pair, i) => (
          <div key={i} className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-conflict-foreground/25 bg-conflict/20 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium leading-snug text-foreground">
                  {pair.obligation.statement}
                </p>
                <ApplicabilityChip label={pair.obligation.applicability} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {pair.obligation.citations.map((c) => (
                  <CitationChip key={c.chunk_id} citation={c} onOpen={onOpenSource} variant="tension" />
                ))}
              </div>
            </div>

            <div className="flex flex-col justify-center rounded-lg border border-dashed border-conflict-foreground/30 bg-conflict/10 p-4">
              <p className="text-xs text-conflict-foreground/80">Pulls against a provision in</p>
              <p className="mt-1 text-sm text-foreground/90">
                {pair.opposing.hierarchy_path.length > 0
                  ? pair.opposing.hierarchy_path.join(" › ")
                  : `${pair.opposing.framework} ${pair.opposing.citation_label}`}
              </p>
              <div className="mt-3">
                <CitationChip citation={pair.opposing} onOpen={onOpenSource} variant="tension" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
