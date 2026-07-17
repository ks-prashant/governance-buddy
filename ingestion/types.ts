/**
 * Shared parse-output types. Every framework parser (gdpr, eu-ai-act, nist-*)
 * emits a `ParsedFramework` so the downstream chunk → embed → load steps are
 * framework-agnostic (build plan §E: "the same interface").
 *
 * The parser's job is DETERMINISTIC STRUCTURING only (system design §5.1): turn a
 * source PDF into a clean, reviewable hierarchy. No embeddings, no LLM guessing.
 * The committed artifact is `corpus-build/<framework>.json` — the auditable unit.
 */

/** A retrievable child unit (paragraph / point / subcategory) — what gets embedded. */
export interface ParsedChild {
  /** Canonical mono citation label for display, e.g. "Art. 22(1)". */
  citation_label: string;
  /** Anchor in the golden-set style, e.g. "Article 22(1)" — used by the validate gate. */
  anchor: string;
  /** Full hierarchy path, e.g. ["GDPR","Chapter III","Section 4","Article 22","(1)"]. */
  hierarchy_path: string[];
  /** Verbatim child text (includes the paragraph's inline points where applicable). */
  text: string;
}

/** A parent unit (article / section / practice) — generation context + source-viewer unit. */
export interface ParsedParent {
  /** Canonical mono citation label, e.g. "Art. 22" or "Recital 71". */
  citation_label: string;
  anchor: string;
  hierarchy_path: string[];
  /** Full verbatim parent text. */
  text: string;
  /** Optional page range if known from the source. */
  page_from?: number;
  page_to?: number;
  /** Official-source URL/anchor where one exists (FR-5.3). */
  source_url?: string;
  children: ParsedChild[];
}

export interface ParsedFramework {
  framework_id: string; // matches the seeded frameworks.id, e.g. "gdpr"
  framework_name: string; // e.g. "GDPR"
  version_label: string; // e.g. "Regulation (EU) 2016/679 — OJ L 119, 4.5.2016"
  source_url: string; // official published source (EUR-Lex / NIST)
  source_file: string; // corpus/<file>.pdf that produced this
  parsed_at: string; // ISO timestamp
  parents: ParsedParent[];
}

/** A count summary for quick eyeballing / validation. */
export function summarize(f: ParsedFramework): string {
  const children = f.parents.reduce((n, p) => n + p.children.length, 0);
  return `${f.framework_name}: ${f.parents.length} parents, ${children} children`;
}
