/**
 * Deterministic NIST AI RMF 1.0 parser (system design §5.1–§5.3, build plan §E step 1).
 *
 * The AI RMF has two parts the product cites, parsed here into one framework:
 *
 *  1. The seven trustworthiness characteristics (§3.1–§3.7). These are the units the
 *     golden set references ("Section 3.7 (Fair - with Harmful Bias Managed)"). Each is a
 *     parent with a single child holding its full explanatory text (recital-style).
 *
 *  2. The AI RMF Core (§5): four Functions (GOVERN, MAP, MEASURE, MANAGE) → Categories →
 *     Subcategories (e.g. "GOVERN 1.1"). The Core tables are heavily fragmented by page
 *     breaks (Categories and Subcategories split into separate blocks, category
 *     descriptions cut mid-sentence), so — as with SSDF — subcategories are the retrieved
 *     children and are filed under their Function by ID prefix ("GOVERN 1.1" → "GOVERN"),
 *     never by reading position. The Function is the generation-context parent.
 *
 * Output: corpus-build/nist_ai_rmf.json (committed, reviewable, NO embeddings).
 * Run: `bun ingestion/parsers/nist-ai-rmf.ts`
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractText } from "../lib/pdf";
import type { ParsedChild, ParsedFramework, ParsedParent } from "../types";
import { summarize } from "../types";

const FRAMEWORK_ID = "nist_ai_rmf";
const FRAMEWORK_NAME = "NIST AI RMF";
const VERSION_LABEL = "NIST AI 100-1 — Artificial Intelligence Risk Management Framework (AI RMF 1.0)";
const SOURCE_URL = "https://doi.org/10.6028/NIST.AI.100-1";

const CHAR_SECTION = "Section 3. AI Risks and Trustworthiness";
const CORE_SECTION = "AI RMF Core";
const FUNCTIONS = ["GOVERN", "MAP", "MEASURE", "MANAGE"] as const;

// Page furniture interleaving both the §3 prose and the Core tables.
const RE_FURNITURE = [
  /^Page \d+$/,
  /^\d{1,3}$/,
  /^NIST AI 100-1$/,
  /^AI RMF 1\.0$/,
  /^Categories$/,
  /^Subcategories$/,
  /^Continued on next page$/,
  /^Table \d+:.*/,
];

/** Normalize en/em dashes to a plain " - " so anchors match the golden set exactly. */
const normDash = (s: string) => s.replace(/\s*[–—]\s*/g, " - ").replace(/\s+/g, " ").trim();

function cleanLines(raw: string): string[] {
  const out: string[] = [];
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line === "") continue;
    if (RE_FURNITURE.some((re) => re.test(line))) continue;
    out.push(line);
  }
  return out;
}

// ── Part 1: trustworthiness characteristics (§3.1–§3.7) ──────────────────────
function parseCharacteristics(lines: string[]): ParsedParent[] {
  // The characteristics appear twice: a bare summary list (Part 1 overview) and the full
  // body under "3. AI Risks and Trustworthiness". Take the body — the LAST run of 3.x
  // headers — which is the one followed by explanatory paragraphs.
  const headIdxs = lines
    .map((l, i) => ({ i, m: /^3\.([1-7]) (.+)$/.exec(l) }))
    .filter((x) => x.m);
  // The body run is the second occurrence of "3.1 …" onward.
  const first31 = headIdxs.findIndex((x) => x.m![1] === "1");
  const body31 = headIdxs.findIndex((x, k) => x.m![1] === "1" && k > first31);
  const bodyHeads = body31 === -1 ? headIdxs : headIdxs.slice(body31);

  // End of §3 body = the "4. Effectiveness of the AI RMF" heading after the last char.
  const lastHeadLine = bodyHeads[bodyHeads.length - 1].i;
  let sectionEnd = lines.findIndex((l, i) => i > lastHeadLine && /^4\.? Effectiveness of the AI RMF$/.test(l));
  if (sectionEnd === -1) sectionEnd = lines.length;

  const parents: ParsedParent[] = [];
  for (let k = 0; k < bodyHeads.length; k++) {
    const head = bodyHeads[k];
    const num = head.m![1];
    const name = normDash(head.m![2]);
    const bodyStart = head.i + 1;
    const bodyEnd = k + 1 < bodyHeads.length ? bodyHeads[k + 1].i : sectionEnd;
    const text = lines.slice(bodyStart, bodyEnd).join(" ").replace(/\s+/g, " ").trim();
    if (!text) continue;

    const anchor = `Section 3.${num} (${name})`;
    const path = [FRAMEWORK_NAME, CHAR_SECTION, `3.${num} ${name}`];
    parents.push({
      citation_label: anchor,
      anchor,
      hierarchy_path: path,
      text: `3.${num} ${name}\n\n${text}`,
      source_url: SOURCE_URL,
      children: [{ citation_label: anchor, anchor, hierarchy_path: path, text }],
    });
  }
  return parents;
}

// ── Part 2: the Core (Functions → Subcategories) ─────────────────────────────
function parseCore(lines: string[]): ParsedParent[] {
  // Require the "5. " section-number period so the body heading is selected, not the
  // dot-leader table-of-contents entry ("5 AI RMF Core"), which appears earlier.
  const start = lines.findLastIndex((l) => /^5\. AI RMF Core$/.test(l));
  let end = lines.findIndex((l, i) => i > start && /^6\. AI RMF Profiles$/.test(l));
  if (start === -1) throw new Error("Could not locate the AI RMF Core (§5)");
  if (end === -1) end = lines.length;
  const S = lines.slice(start, end).join(" ");

  // Subcategory markers "FUNC N.M:" — the retrievable children.
  const subRe = /(GOVERN|MAP|MEASURE|MANAGE) (\d+)\.(\d+):/g;
  const marks: Array<{ fn: string; sid: string; idx: number; contentStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = subRe.exec(S))) {
    marks.push({ fn: m[1], sid: `${m[1]} ${m[2]}.${m[3]}`, idx: m.index, contentStart: subRe.lastIndex });
  }

  const childrenByFn = new Map<string, ParsedChild[]>();
  for (let i = 0; i < marks.length; i++) {
    const mk = marks[i];
    const end2 = i + 1 < marks.length ? marks[i + 1].idx : S.length;
    const text = S.slice(mk.contentStart, end2).replace(/\s+/g, " ").trim();
    if (/^Moved to\b/i.test(text) || text.length < 3) continue;
    const list = childrenByFn.get(mk.fn) ?? [];
    list.push({ citation_label: mk.sid, anchor: mk.sid, hierarchy_path: [], text: `${mk.sid}: ${text}` });
    childrenByFn.set(mk.fn, list);
  }

  const parents: ParsedParent[] = [];
  for (const fn of FUNCTIONS) {
    const children = childrenByFn.get(fn);
    if (!children || children.length === 0) continue;
    const path = [FRAMEWORK_NAME, CORE_SECTION, fn];
    for (const c of children) c.hierarchy_path = [...path, c.citation_label];
    parents.push({
      citation_label: fn,
      anchor: fn,
      hierarchy_path: path,
      text: `${fn} function\n\n` + children.map((c) => c.text).join("\n"),
      source_url: SOURCE_URL,
      children,
    });
  }
  return parents;
}

export function parseNistAiRmf(pdfPath: string): ParsedFramework {
  const lines = cleanLines(extractText(pdfPath));
  const parents = [...parseCharacteristics(lines), ...parseCore(lines)];
  return {
    framework_id: FRAMEWORK_ID,
    framework_name: FRAMEWORK_NAME,
    version_label: VERSION_LABEL,
    source_url: SOURCE_URL,
    source_file: "corpus/nist-ai-rmf.pdf",
    parsed_at: new Date().toISOString(),
    parents,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

if (import.meta.main) {
  const pdfPath = resolve(repoRoot, "corpus/nist-ai-rmf.pdf");
  const outPath = resolve(repoRoot, "corpus-build/nist_ai_rmf.json");
  const parsed = parseNistAiRmf(pdfPath);
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  console.log(summarize(parsed));
  const chars = parsed.parents.filter((p) => p.anchor.startsWith("Section 3.")).length;
  const core = parsed.parents.filter((p) => (FUNCTIONS as readonly string[]).includes(p.anchor));
  console.log(`  characteristics: ${chars}`);
  for (const p of core) console.log(`  ${p.anchor}: ${p.children.length} subcategories`);
  console.log(`  wrote ${outPath}`);
}
