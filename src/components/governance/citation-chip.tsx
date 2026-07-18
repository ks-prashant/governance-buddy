/**
 * The citation — the hero interaction (design guidelines §5.7). Unmistakably clickable,
 * mono label, the reserved "open source" icon. Treat as the primary CTA of the whole app:
 * this single click is the product's core promise ("verifiable in one click") made physical.
 */
import { ScrollText } from "lucide-react";
import type { Citation } from "@/hooks/use-obligation-stream";
import { cn } from "@/lib/utils";

export function CitationChip({
  citation,
  onOpen,
  variant = "default",
}: {
  citation: Citation;
  onOpen: (citation: Citation) => void;
  variant?: "default" | "tension";
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(citation)}
      className={cn(
        "group inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 font-citation text-xs transition-colors",
        variant === "default" &&
          "border-primary/25 bg-primary/5 text-primary hover:border-primary/50 hover:bg-primary/10",
        variant === "tension" &&
          "border-conflict-foreground/25 bg-conflict/40 text-conflict-foreground hover:bg-conflict/60",
      )}
    >
      <ScrollText className="h-3.5 w-3.5 shrink-0 opacity-70 group-hover:opacity-100" aria-hidden />
      <span className="truncate">
        {citation.framework} · {citation.citation_label}
      </span>
    </button>
  );
}
