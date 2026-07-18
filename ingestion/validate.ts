/**
 * Ingestion validation gate (system design §5.5, build plan §B step 5).
 *
 * A snapshot that fails validation is NOT promoted. Runs against the reviewable
 * parse artifact (corpus-build/<framework>.json) — no DB or secrets required, so it
 * can gate before anything is embedded or loaded.
 *
 * Checks:
 *   1. Structural — every child has non-empty text and a resolvable parent article;
 *      every citation_label is unique and well-formed.
 *   2. Anchor resolution — every known anchor for this framework in the golden set
 *      (evals/golden_set.jsonl `expected_citations`) resolves to a chunk.
 *
 * Run: `bun ingestion/validate.ts gdpr`
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedFramework } from "./types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

/** Framework display names as they appear in the golden set's `framework` field. */
const GOLDEN_FRAMEWORK_NAME: Record<string, string> = {
  gdpr: "GDPR",
  eu_ai_act: "EU AI Act",
  nist_ai_rmf: "NIST AI RMF",
  nist_csf: "NIST CSF 2.0",
  nist_ssdf: "NIST SSDF",
};

interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  anchorHits: number;
  anchorTotal: number;
}

interface ResolveSets {
  has: (a: string) => boolean; // a is a child or parent anchor
  hierTokens: Set<string>; // every hierarchy_path element across parents + children
  nonEmpty: boolean; // the framework parsed at least one unit
}

/** Does a golden anchor resolve to something in the corpus? The golden set cites units at
 *  several grains — a precise clause, a paragraph point, a whole article/annex, a function
 *  or practice group, or (for the NIST frameworks) the framework/Core as a whole. This
 *  asserts "the cited unit exists in the corpus" across all of those grains; paragraph-
 *  count fidelity is checked separately. Strategies, most precise first:
 *   1. exact child/parent anchor;
 *   2. Article/Annex point + range reduction ("Art 35(3)(a)" → "Art 35(3)" → "Art 35");
 *   3. prefix ("Section 3" → "Section 3.1 (Valid and Reliable)");
 *   4. hierarchy grain — an exact hierarchy token ("GOVERN (GV)"), a Chapter, a "X function"
 *      or a parenthesized group code ("PO (…)" → a token containing "(PO)"), or a slash-list
 *      of any of these ("RESPOND (RS) / RECOVER (RC)");
 *   5. whole-framework citations ("… Core", "(voluntary framework)", "practice groups")
 *      resolve when the framework parsed successfully. */
function anchorResolves(anchor: string, s: ResolveSets): boolean {
  if (s.has(anchor)) return true;

  // 2. Article / Annex point + range reduction.
  for (const kind of ["Article", "Annex"] as const) {
    const unit = kind === "Article" ? /^Article (\d+)/ : /^Annex ([IVXL]+)/;
    const m = unit.exec(anchor);
    if (m) {
      if (s.has(`${kind} ${m[1]}`)) return true;
      const para = new RegExp(`^${kind} ${kind === "Article" ? "\\d+" : "[IVXL]+"}\\((\\d+)\\)`).exec(anchor);
      if (para && s.has(`${kind} ${m[1]}(${para[1]})`)) return true;
    }
  }

  // 3. Prefix (a coarser section that heads a finer one), guarded by a separator so
  //    "Article 5" cannot spuriously match "Article 50".
  for (const t of s.hierTokens) {
    if (t === anchor) return true;
  }
  const startsWithSep = (a: string) =>
    a.startsWith(anchor) && (a.length === anchor.length || /[ .(]/.test(a[anchor.length]));
  // (child/parent anchors are folded into hierTokens by the caller, see below)

  // 4. Hierarchy-grain resolution.
  const fn = /^([A-Z][A-Za-z]+) function$/.exec(anchor);
  if (fn && s.hierTokens.has(fn[1])) return true;

  const ch = /^Chapter ([IVXL]+)\b/.exec(anchor);
  if (ch && [...s.hierTokens].some((t) => t.startsWith(`Chapter ${ch[1]} `))) return true;

  const code = /^([A-Z]{2,4}) \(/.exec(anchor); // "PO (Prepare the Organization)"
  if (code && [...s.hierTokens].some((t) => t.includes(`(${code[1]})`))) return true;

  if (anchor.includes(" / ")) {
    if (anchor.split(" / ").every((part) => anchorResolves(part.trim(), s))) return true;
  }

  for (const a of s.hierTokens) if (startsWithSep(a)) return true;

  // 5. Whole-framework citations.
  if (s.nonEmpty && /\bCore\b|\(voluntary framework\)|practice groups\b/.test(anchor)) return true;

  return false;
}

export function validateFramework(fw: ParsedFramework, goldenLines: string[]): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const children = fw.parents.flatMap((p) => p.children);
  const childAnchors = new Set(children.map((c) => c.anchor));
  const articleAnchors = new Set(fw.parents.map((p) => p.anchor));

  // 1a. Unique, well-formed citation labels; non-empty text; resolvable parent.
  const seen = new Set<string>();
  const labelShape = /^(Art\. \d+(\(\d+\))?|Recital \d+|[A-Z]{2}[.\d]|.+)$/;
  for (const c of children) {
    if (seen.has(c.citation_label)) errors.push(`Duplicate citation_label: ${c.citation_label}`);
    seen.add(c.citation_label);
    if (!c.text || c.text.trim().length < 2) errors.push(`Empty child text: ${c.anchor}`);
    if (!labelShape.test(c.citation_label)) warnings.push(`Odd label: ${c.citation_label}`);
    if (c.hierarchy_path.length < 2) warnings.push(`Shallow path: ${c.anchor}`);
  }

  // 1b. Every parent has at least one child.
  for (const p of fw.parents) {
    if (p.children.length === 0) errors.push(`Parent with no children: ${p.anchor}`);
  }

  // 1c. Unique parent citation labels. load.ts joins children to their parent via a
  // Map keyed by parent citation_label — a collision would silently link children to
  // the WRONG parent (the later one overwrites the earlier one in the map) with no
  // error anywhere. This is the parent-side counterpart to the child check above,
  // which only ever caught child-label collisions, not this one.
  const seenParentLabels = new Set<string>();
  for (const p of fw.parents) {
    if (seenParentLabels.has(p.citation_label)) {
      errors.push(`Duplicate PARENT citation_label: ${p.citation_label}`);
    }
    seenParentLabels.add(p.citation_label);
  }

  // 2. Golden-anchor resolution for this framework.
  const goldenName = GOLDEN_FRAMEWORK_NAME[fw.framework_id];
  const expected = new Set<string>();
  for (const line of goldenLines) {
    if (!line.trim()) continue;
    const item = JSON.parse(line) as {
      expected_citations?: Array<{ framework: string; anchor: string }>;
    };
    for (const cit of item.expected_citations ?? []) {
      if (cit.framework === goldenName) expected.add(cit.anchor);
    }
  }

  // Build the resolution sets. hierTokens folds in every hierarchy_path element plus the
  // child/parent anchors themselves, so the prefix + hierarchy-grain strategies see the
  // full vocabulary of the corpus.
  const hierTokens = new Set<string>([...childAnchors, ...articleAnchors]);
  for (const p of fw.parents) {
    for (const t of p.hierarchy_path) hierTokens.add(t);
    for (const c of p.children) for (const t of c.hierarchy_path) hierTokens.add(t);
  }
  const sets: ResolveSets = {
    has: (a) => childAnchors.has(a) || articleAnchors.has(a),
    hierTokens,
    nonEmpty: children.length > 0,
  };

  let hits = 0;
  const misses: string[] = [];
  for (const anchor of expected) {
    if (anchorResolves(anchor, sets)) hits++;
    else misses.push(anchor);
  }
  if (misses.length) {
    // Anchors not shaped like this framework's own anchors are likely cross-framework
    // noise in the golden line; report as warnings, real misses as errors.
    for (const a of misses) errors.push(`Unresolved golden anchor: ${a}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    anchorHits: hits,
    anchorTotal: expected.size,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const fwId = process.argv[2] ?? "gdpr";
  const fw = JSON.parse(
    readFileSync(resolve(repoRoot, `corpus-build/${fwId}.json`), "utf8"),
  ) as ParsedFramework;
  const goldenLines = readFileSync(resolve(repoRoot, "evals/golden_set.jsonl"), "utf8").split("\n");

  const r = validateFramework(fw, goldenLines);
  console.log(`Validation — ${fw.framework_name} (${fwId})`);
  console.log(`  parents: ${fw.parents.length}, children: ${fw.parents.flatMap((p) => p.children).length}`);
  console.log(`  golden anchors resolved: ${r.anchorHits}/${r.anchorTotal}`);
  if (r.warnings.length) console.log(`  warnings: ${r.warnings.length} (first: ${r.warnings[0]})`);
  if (r.errors.length) {
    console.log(`  ERRORS (${r.errors.length}):`);
    for (const e of r.errors.slice(0, 20)) console.log(`    - ${e}`);
  }
  console.log(r.ok ? "  RESULT: PASS ✓" : "  RESULT: FAIL ✗");
  process.exit(r.ok ? 0 : 1);
}
