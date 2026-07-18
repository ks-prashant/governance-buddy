/**
 * Honest empty state (PRD §6.2, design guidelines §5.11, §5.14) — retrieval was
 * on-topic but nothing survived validation. A valid, well-designed outcome, never a
 * fabricated list.
 */
import { Button } from "@/components/ui/button";

export function EmptyState({
  message,
  gaps,
  onTryAgain,
}: {
  message: string;
  gaps: string[];
  onTryAgain: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 p-6">
      <p className="text-sm font-medium text-foreground">Nothing clearly applies here</p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{message}</p>
      {gaps.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-muted-foreground">
          {gaps.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <Button variant="outline" size="sm" className="shadow-none" onClick={onTryAgain}>
          Broaden or rephrase
        </Button>
      </div>
    </div>
  );
}
