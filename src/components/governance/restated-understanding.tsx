/**
 * Restated understanding (PRD §6.1 Step 4, design guidelines §5.4) — a trust
 * checkpoint: confirm the grounding of the mapping before the user relies on it, with
 * an inline "Not quite? Refine" affordance to correct a misread.
 */
import { Pencil } from "lucide-react";

export function RestatedUnderstanding({
  text,
  onRefine,
}: {
  text: string;
  onRefine: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-l-2 border-primary/40 pl-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <p className="text-sm leading-relaxed text-foreground">
        <span className="text-muted-foreground">Understood: </span>
        {text}
      </p>
      <button
        type="button"
        onClick={onRefine}
        className="inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
      >
        <Pencil className="h-3 w-3" aria-hidden />
        Not quite? Refine
      </button>
    </div>
  );
}
