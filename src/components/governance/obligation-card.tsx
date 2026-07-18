/**
 * Obligation card anatomy (design guidelines §5.5): statement first (largest), the
 * "why this applies to your system" rationale, citation chips, applicability chip.
 * Every substantive statement is cited — there is no path to render a card without
 * at least one citation (PRD §8.3 FR-3.4).
 */
import { useState } from "react";
import { AlertTriangle, MessageSquarePlus } from "lucide-react";
import type { AssembledObligation, Citation } from "@/hooks/use-obligation-stream";
import { ApplicabilityChip } from "./applicability-chip";
import { CitationChip } from "./citation-chip";
import { FollowUpBox } from "./follow-up-box";

export function ObligationCard({
  obligation,
  originalInput,
  onOpenSource,
  allowFollowUp = true,
}: {
  obligation: AssembledObligation;
  originalInput: string;
  onOpenSource: (citation: Citation) => void;
  allowFollowUp?: boolean;
}) {
  const [followUpOpen, setFollowUpOpen] = useState(false);

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

      {!allowFollowUp ? null : !followUpOpen ? (
        <button
          type="button"
          onClick={() => setFollowUpOpen(true)}
          className="mt-3 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
          Ask a follow-up about this
        </button>
      ) : (
        <FollowUpBox
          compact
          onOpenSource={onOpenSource}
          placeholder="Ask a follow-up about this obligation…"
          contextText={
            `The user described their system as: "${originalInput}". A generated obligation ` +
            `stated: "${obligation.statement}" (citing ${obligation.citations
              .map((c) => `${c.framework} ${c.citation_label}`)
              .join(", ")}).`
          }
        />
      )}
    </div>
  );
}
