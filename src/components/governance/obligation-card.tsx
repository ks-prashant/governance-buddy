/**
 * Obligation card anatomy (design guidelines §5.5): statement first (largest), the
 * "why this applies to your system" rationale, citation chips, applicability chip.
 * Every substantive statement is cited — there is no path to render a card without
 * at least one citation (PRD §8.3 FR-3.4).
 */
import { AlertTriangle } from "lucide-react";
import type { AssembledObligation, Citation } from "@/hooks/use-obligation-stream";
import { ApplicabilityChip } from "./applicability-chip";
import { CitationChip } from "./citation-chip";

export function ObligationCard({
  obligation,
  onOpenSource,
}: {
  obligation: AssembledObligation;
  onOpenSource: (citation: Citation) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-medium leading-snug text-foreground">{obligation.statement}</p>
        <ApplicabilityChip label={obligation.applicability} />
      </div>

      {obligation.rationale && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground/80">Why this applies to your system — </span>
          {obligation.rationale}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {obligation.citations.map((c) => (
          <CitationChip key={c.chunk_id} citation={c} onOpen={onOpenSource} />
        ))}
        {obligation.conflicts_with && (
          <span className="inline-flex items-center gap-1 text-xs text-conflict-foreground/90">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            In tension with another framework — see below
          </span>
        )}
      </div>
    </div>
  );
}
