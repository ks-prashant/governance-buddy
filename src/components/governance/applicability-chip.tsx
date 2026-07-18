/**
 * Applicability label (PRD §8.4, design guidelines §4.8) — Direct / Inferred / Possible,
 * shown as a labeled chip with a filled → half → outline treatment of the SAME accent.
 * Never a percentage or confidence score; the shape/fill difference (not color alone)
 * carries the distinction so it stays legible without color (§4.3, §7).
 */
import type { ApplicabilityLabel } from "@/hooks/use-obligation-stream";
import { cn } from "@/lib/utils";

const STYLES: Record<ApplicabilityLabel, string> = {
  Direct: "bg-applicability-direct text-applicability-direct-foreground border-transparent",
  Inferred: "bg-applicability-inferred text-applicability-inferred-foreground border-transparent",
  Possible: "bg-applicability-possible text-applicability-possible-foreground border-border",
};

const DESCRIPTIONS: Record<ApplicabilityLabel, string> = {
  Direct: "Stated directly in a retrieved clause matching your system",
  Inferred: "Applies via reasonable inference from retrieved clauses",
  Possible: "Tangentially related — worth a review",
};

export function ApplicabilityChip({ label }: { label: ApplicabilityLabel }) {
  return (
    <span
      title={DESCRIPTIONS[label]}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        STYLES[label],
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          label === "Direct" && "bg-current",
          label === "Inferred" && "bg-current opacity-60",
          label === "Possible" && "border border-current bg-transparent",
        )}
      />
      {label}
    </span>
  );
}
