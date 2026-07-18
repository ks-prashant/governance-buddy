/**
 * Deterministic NIST CSF 2.0 parser (system design §5.1–§5.3, build plan §E step 1).
 *
 * Parses corpus/nist-csf-2.0.pdf's Core into its real hierarchy:
 *   Function (GOVERN/IDENTIFY/PROTECT/DETECT/RESPOND/RECOVER)
 *     → Category (e.g. "Data Security (PR.DS)")
 *       → Subcategory (e.g. "PR.DS-01")
 *
 * Parent unit  = Category (the source-viewer + generation-context unit).
 * Child unit   = Subcategory (embedded/retrieved) — the smallest actionable outcome.
 * Function is carried in the hierarchy_path, not as its own retrievable unit.
 *
 * The Core is laid out as bulleted lists that pdftotext mostly keeps, but with page
 * furniture interleaved and (on some pages) categories/subcategories collapsed onto a
 * single line with "•"/"o" bullets. We strip furniture line-by-line, join, then tokenize
 * by the bullet chars + the stable "XX.YY" / "XX.YY-NN" id shapes — parentheses around a
 * category id ("(PR.DS):") vs. a bare subcategory id ("PR.DS-01:") disambiguate the two.
 *
 * Output: corpus-build/nist_csf.json (committed, reviewable, NO embeddings).
 * Run: `bun ingestion/parsers/nist-csf.ts`
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractText } from "../lib/pdf";
import type { ParsedChild, ParsedFramework, ParsedParent } from "../types";
import { summarize } from "../types";

const FRAMEWORK_ID = "nist_csf";
const FRAMEWORK_NAME = "NIST CSF 2.0";
const VERSION_LABEL = "NIST CSWP 29 — The NIST Cybersecurity Framework (CSF) 2.0 (February 26, 2024)";
const SOURCE_URL = "https://doi.org/10.6028/NIST.CSWP.29";

const FUNCTION_NAMES: Record<string, string> = {
  GV: "GOVERN",
  ID: "IDENTIFY",
  PR: "PROTECT",
  DE: "DETECT",
  RS: "RESPOND",
  RC: "RECOVER",
};

// A function header opens each function's block: "PROTECT (PR): Safeguards to manage…".
const RE_FUNCTION = /^(GOVERN|IDENTIFY|PROTECT|DETECT|RESPOND|RECOVER) \(([A-Z]{2})\):\s*(.*)$/;
// Page furniture that interleaves the Core lists.
const RE_FURNITURE = [
  /^\d{1,3}$/, // bare page number
  /^NIST CSWP 29\b/,
  /^The NIST Cybersecurity Framework \(CSF\) 2\.0$/,
];

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

/** Isolate the Core: from the first function header line to "Appendix …". */
function sliceCore(lines: string[]): string {
  const start = lines.findIndex((l) => RE_FUNCTION.test(l));
  if (start === -1) throw new Error("Could not locate the CSF Core (no function header found)");
  let end = lines.findIndex((l, i) => i > start && /^Appendix\b/.test(l));
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join(" ");
}

/** Split the Core into per-function blocks, preserving each function's id + description. */
function splitFunctions(core: string): Array<{ fnId: string; fnName: string; fnDesc: string; body: string }> {
  const re = /(GOVERN|IDENTIFY|PROTECT|DETECT|RESPOND|RECOVER) \(([A-Z]{2})\):/g;
  const heads: Array<{ fnId: string; idx: number; contentStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(core))) heads.push({ fnId: m[2], idx: m.index, contentStart: re.lastIndex });
  return heads.map((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].idx : core.length;
    const segment = core.slice(h.contentStart, end).trim();
    // The function description runs until the first category bullet "•".
    const firstBullet = segment.indexOf("•");
    const fnDesc = (firstBullet === -1 ? segment : segment.slice(0, firstBullet)).trim();
    const body = firstBullet === -1 ? "" : segment.slice(firstBullet);
    return { fnId: h.fnId, fnName: FUNCTION_NAMES[h.fnId], fnDesc, body };
  });
}

/** Within a function body, each "•"-delimited segment is one category with its subcategories. */
function parseCategories(
  body: string,
  fnLabel: string,
): ParsedParent[] {
  const parents: ParsedParent[] = [];
  const segments = body
    .split("•")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    const head = /^(.+?)\s*\(([A-Z]{2}\.[A-Z]{2})\):\s*(.*)$/.exec(seg);
    if (!head) continue; // not a category segment (defensive)
    const name = head[1].trim();
    const catId = head[2];
    const remainder = head[3];

    // Slice subcategories out of the remainder by their stable "XX.YY-NN:" ids.
    const subRe = /([A-Z]{2}\.[A-Z]{2}-\d{2}):/g;
    const marks: Array<{ id: string; idx: number; contentStart: number }> = [];
    let sm: RegExpExecArray | null;
    while ((sm = subRe.exec(remainder))) marks.push({ id: sm[1], idx: sm.index, contentStart: subRe.lastIndex });

    const catDesc = (marks.length ? remainder.slice(0, marks[0].idx) : remainder)
      .replace(/\s*o\s*$/, "")
      .trim();
    const catPath = [FRAMEWORK_NAME, fnLabel, `${name} (${catId})`];

    const children: ParsedChild[] = marks.map((mk, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].idx : remainder.length;
      const text = remainder
        .slice(mk.contentStart, end)
        .replace(/\s*o\s*$/, "") // drop the trailing "o" bullet of the next subcategory
        .trim();
      return {
        citation_label: mk.id,
        anchor: mk.id,
        hierarchy_path: [...catPath, mk.id],
        text: `${mk.id}: ${text}`,
      };
    });

    if (children.length === 0) continue; // a category with no subcategories isn't retrievable

    const parentText =
      `${name} (${catId}): ${catDesc}`.trim() + "\n\n" + children.map((c) => c.text).join("\n");
    parents.push({
      citation_label: catId,
      anchor: catId,
      hierarchy_path: catPath,
      text: parentText.trim(),
      source_url: SOURCE_URL,
      children,
    });
  }
  return parents;
}

export function parseNistCsf(pdfPath: string): ParsedFramework {
  const raw = extractText(pdfPath);
  const lines = cleanLines(raw);
  const core = sliceCore(lines);
  const functions = splitFunctions(core);

  const parents: ParsedParent[] = [];
  for (const fn of functions) {
    const fnLabel = `${fn.fnName} (${fn.fnId})`;
    parents.push(...parseCategories(fn.body, fnLabel));
  }

  return {
    framework_id: FRAMEWORK_ID,
    framework_name: FRAMEWORK_NAME,
    version_label: VERSION_LABEL,
    source_url: SOURCE_URL,
    source_file: "corpus/nist-csf-2.0.pdf",
    parsed_at: new Date().toISOString(),
    parents,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

if (import.meta.main) {
  const pdfPath = resolve(repoRoot, "corpus/nist-csf-2.0.pdf");
  const outPath = resolve(repoRoot, "corpus-build/nist_csf.json");
  const parsed = parseNistCsf(pdfPath);
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  console.log(summarize(parsed));
  const byFn = new Map<string, number>();
  for (const p of parsed.parents) {
    const fn = p.hierarchy_path[1] ?? "?";
    byFn.set(fn, (byFn.get(fn) ?? 0) + 1);
  }
  for (const [fn, n] of byFn) console.log(`  ${fn}: ${n} categories`);
  console.log(`  wrote ${outPath}`);
}
