/**
 * Error state (PRD §9, §13) — non-alarming, offers retry, never renders a partial
 * fabricated answer.
 */
import { Button } from "@/components/ui/button";

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <p className="text-sm font-medium text-foreground">This didn't go through</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        Something went wrong on the way to an answer. Nothing partial was generated.{" "}
        {message && <span className="opacity-70">({message})</span>}
      </p>
      <div className="mt-4">
        <Button size="sm" className="shadow-none" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}
