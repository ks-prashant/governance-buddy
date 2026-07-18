/**
 * Persistent corpus-version indicator (PRD §8.7 FR-7.1, design guidelines §5.13) —
 * unobtrusive, always present, never shouting. Hover/focus reveals per-framework
 * versions. The corpus never claims to reflect current law beyond this snapshot.
 */
import { useEffect, useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CorpusInfo {
  snapshot_date: string;
  frameworks: Array<{ id: string; name: string; version_label: string }>;
}

export function CorpusIndicator() {
  const [info, setInfo] = useState<CorpusInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/corpus")
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled && !body.error) setInfo(body as CorpusInfo);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!info) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="cursor-default rounded-sm font-citation text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
            aria-label={`Corpus as of ${info.snapshot_date}. Activate for framework versions.`}
          >
            Corpus as of {info.snapshot_date}
          </button>
        </TooltipTrigger>
        <TooltipContent align="end" className="max-w-xs">
          <ul className="space-y-1 font-citation text-xs">
            {info.frameworks.map((f) => (
              <li key={f.id} className="flex justify-between gap-3">
                <span>{f.name}</span>
                <span className="text-muted-foreground">{f.version_label}</span>
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
