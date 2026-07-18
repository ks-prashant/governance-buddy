/**
 * Refusal card (PRD §8.4, design guidelines §5.9) — out-of-corpus questions. Refusing
 * well is the product working correctly: neutral tone, not error-red, not an apology,
 * never a dead end.
 */
import { CircleSlash } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RefusalCard({ message, onTryAgain }: { message: string; onTryAgain: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-refusal p-6 text-refusal-foreground">
      <div className="flex items-start gap-3">
        <CircleSlash className="mt-0.5 h-5 w-5 shrink-0 opacity-70" aria-hidden />
        <div>
          <p className="text-sm font-medium">Outside what this corpus covers</p>
          <p className="mt-1.5 text-sm leading-relaxed opacity-90">{message}</p>
        </div>
      </div>
      <div className="mt-4">
        <Button variant="outline" size="sm" className="shadow-none" onClick={onTryAgain}>
          Ask something else
        </Button>
      </div>
    </div>
  );
}
