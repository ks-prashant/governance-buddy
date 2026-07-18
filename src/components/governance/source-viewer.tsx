/**
 * Source viewer — the payoff moment (design guidelines §5.8, PRD §8.5). Opens the exact
 * cited paragraph, highlighted, in its surrounding parent context; shows the full
 * hierarchy breadcrumb, framework version, and snapshot date; links to the official
 * source. Typeset in the source serif so it reads as primary material, distinct from
 * the product's own voice (§4.4).
 *
 * Fetches text on demand from /api/source — citation payloads in the stream carry only
 * trusted metadata + chunk_id, never text (system design §7.1 principle #3).
 */
import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Citation } from "@/hooks/use-obligation-stream";

interface SourcePayload {
  framework: string;
  citation_label: string;
  hierarchy_path: string[];
  chunk_text: string;
  parent_citation_label: string;
  parent_text: string;
  source_url: string | null;
  version_label: string | null;
  snapshot_date: string | null;
}

function highlight(parentText: string, chunkText: string) {
  const idx = parentText.indexOf(chunkText);
  if (idx === -1) return { before: parentText, match: "", after: "" };
  return {
    before: parentText.slice(0, idx),
    match: parentText.slice(idx, idx + chunkText.length),
    after: parentText.slice(idx + chunkText.length),
  };
}

export function SourceViewer({
  citation,
  onClose,
}: {
  citation: Citation | null;
  onClose: () => void;
}) {
  const [data, setData] = useState<SourcePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!citation) return;
    let cancelled = false;
    setData(null);
    setError(null);
    setLoading(true);
    fetch(`/api/source?chunk_id=${encodeURIComponent(citation.chunk_id)}`)
      .then((res) => res.json())
      .then((body) => {
        if (cancelled) return;
        if (body.error) setError(body.error as string);
        else setData(body as SourcePayload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [citation]);

  const parts = data ? highlight(data.parent_text, data.chunk_text) : null;

  return (
    <Sheet open={citation !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl md:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="font-citation text-sm font-medium text-primary">
            {citation ? `${citation.framework} · ${citation.citation_label}` : ""}
          </SheetTitle>
          <SheetDescription>
            {data?.hierarchy_path?.length ? data.hierarchy_path.join(" › ") : " "}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Opening the source…
            </div>
          )}

          {error && !loading && (
            <p className="text-sm text-muted-foreground">
              Couldn't load this source ({error}). Close and try the citation again.
            </p>
          )}

          {data && !loading && !error && (
            <>
              <div className="rounded-md border border-border bg-background p-5 font-source text-base leading-relaxed text-foreground">
                {parts && parts.match ? (
                  <>
                    <span className="text-muted-foreground">{parts.before}</span>
                    <mark className="rounded bg-source-highlight text-source-highlight-foreground">
                      {parts.match}
                    </mark>
                    <span className="text-muted-foreground">{parts.after}</span>
                  </>
                ) : (
                  data.parent_text
                )}
              </div>

              <dl className="mt-4 space-y-1 font-citation text-xs text-muted-foreground">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-foreground/70">Version:</dt>
                  <dd>{data.version_label ?? "unspecified"}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-foreground/70">Corpus as of:</dt>
                  <dd>{data.snapshot_date ?? "unknown"}</dd>
                </div>
              </dl>

              {data.source_url && (
                <a
                  href={data.source_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  Open official published source
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
