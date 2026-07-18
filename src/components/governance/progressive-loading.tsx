/**
 * Progressive loading (PRD §6.1 Step 3, design guidelines §5.3) — names what's
 * happening, honestly, as it runs. Never a fake spinner with a vague "Thinking…".
 */
import { Loader2 } from "lucide-react";

export function ProgressiveLoading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3.5 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
      <span>{label}</span>
    </div>
  );
}
