/**
 * Deterministic GDPR parser (system design §5.1–§5.3, build plan §B step 2).
 *
 * Parses corpus/gdpr.pdf into its real hierarchy:
 *   Chapter → Section → Article → paragraph (→ inline points), plus Recitals.
 *
 * Parent unit  = Article (or Recital) — the source-viewer + generation context unit.
 * Child unit   = numbered paragraph (with its (a)/(b) points inline) — embedded/retrieved.
 *
 * Output: corpus-build/gdpr.json (committed, reviewable, NO embeddings).
 *
 * Run: `bun ingestion/parsers/gdpr.ts`
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractText } from "../lib/pdf";
import type { ParsedChild, ParsedFramework, ParsedParent } from "../types";
import { summarize } from "../types";

const FRAMEWORK_ID = "gdpr";
const FRAMEWORK_NAME = "GDPR";
const VERSION_LABEL = "Regulation (EU) 2016/679 — OJ L 119, 4.5.2016";
const SOURCE_URL = "https://eur-lex.europa.eu/eli/reg/2016/679/oj";

// ── Page-furniture stripping ────────────────────────────────────────────────
// The OJ running header/footer tokens appear both as standalone lines AND merged
// into content lines (e.g. "Official Journal of the European Union Article 25").
// Remove them as substrings, then drop any line that becomes empty or bare "EN".
const HEADER_SUBSTRINGS = [
  /Official Journal of the European Union/g,
  /\bL 119\/\d+\b/g,
  /\b\d{1,2}\.\d{1,2}\.2016\b/g, // the OJ publication date (running header)
];

function cleanLines(raw: string): string[] {
  const out: string[] = [];
  for (const rawLine of raw.split("\n")) {
    let line = rawLine;
    for (const re of HEADER_SUBSTRINGS) line = line.replace(re, " ");
    line = line.replace(/\s+/g, " ").trim();
    if (line === "" || line === "EN") continue;
    out.push(line);
  }
  return out;
}

// ── Line classifiers ────────────────────────────────────────────────────────
const RE_CHAPTER = /^CHAPTER ([IVXLC]+)$/;
const RE_SECTION = /^Section (\d+)(?:\s+(.*))?$/;
// Strict form: "Article 22" alone on a line — always a heading.
const RE_ARTICLE_STRICT = /^Article (\d+)$/;
// Fuzzy form: "Article 54 Rules on the establishment… 1. Each Member State…" — the
// heading, title, and even the first paragraph collapsed onto one line. Only trusted
// when the number is the next sequential article (guards against cross-references).
const RE_ARTICLE_INLINE = /^Article (\d+)\s+(.+)$/;
// Recital marker; the text may be empty (the number can sit alone on its own line).
const RE_RECITAL = /^\((\d+)\)\s*(.*)$/;
const isArticleHeading = (l: string) =>
  RE_ARTICLE_STRICT.test(l) || RE_ARTICLE_INLINE.test(l);
// Footnote clusters inside the recitals block. These begin with an OJ page reference
// (e.g. "(1) OJ C 229, 31.7.2012, p. 90. (2) OJ C 391 …") — a shape a real recital
// never takes. Kept deliberately TIGHT: recital 3 legitimately opens with
// "Directive 95/46/EC", so we must NOT filter on leading citation words. Sequence
// integrity is enforced by the monotonic recital-number check instead.
const RE_FOOTNOTE = /^\(\d+\)\s+OJ [CL]\b/;
// End of the enacting terms (closing formula + signatures).
const RE_END_OF_TERMS = /^(This Regulation shall be binding in its entirety|Done at Brussels)/;

const toRoman = (r: string) => r; // chapters are labelled with roman numerals as-is

// ── Recitals ────────────────────────────────────────────────────────────────
function parseRecitals(lines: string[]): ParsedParent[] {
  const start = lines.findIndex((l) => l === "Whereas:");
  const end = lines.findIndex((l) => l === "HAVE ADOPTED THIS REGULATION:");
  if (start === -1 || end === -1) throw new Error("Could not locate the recitals block");

  const parents: ParsedParent[] = [];
  let expected = 1;
  let current: ParsedParent | null = null;
  const flush = () => {
    if (current) {
      current.text = current.text.trim();
      current.children[0].text = current.text;
      parents.push(current);
    }
  };

  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (RE_FOOTNOTE.test(line)) continue; // drop footnote clusters
    const m = RE_RECITAL.exec(line);
    if (m && Number(m[1]) === expected) {
      flush();
      const n = Number(m[1]);
      const path = [FRAMEWORK_NAME, "Recitals", `Recital ${n}`];
      const child: ParsedChild = {
        citation_label: `Recital ${n}`,
        anchor: `Recital ${n}`,
        hierarchy_path: path,
        text: m[2],
      };
      current = {
        citation_label: `Recital ${n}`,
        anchor: `Recital ${n}`,
        hierarchy_path: path,
        text: m[2],
        source_url: SOURCE_URL,
        children: [child],
      };
      expected++;
    } else if (current) {
      // Continuation line (wrapped recital text) — append.
      current.text += " " + line;
    }
  }
  flush();
  return parents;
}

// ── Enacting terms (Chapters → Sections → Articles → paragraphs) ─────────────
function parseEnactingTerms(lines: string[]): ParsedParent[] {
  const start = lines.findIndex((l) => l === "HAVE ADOPTED THIS REGULATION:");
  if (start === -1) throw new Error("Could not locate 'HAVE ADOPTED THIS REGULATION:'");

  const parents: ParsedParent[] = [];
  let chapter = "";
  let chapterTitle = "";
  let section = "";
  let sectionTitle = "";

  let lastArticle = 0;
  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];

    if (RE_END_OF_TERMS.test(line)) break;

    const chap = RE_CHAPTER.exec(line);
    if (chap) {
      chapter = `Chapter ${toRoman(chap[1])}`;
      chapterTitle = lines[i + 1] ?? "";
      section = "";
      sectionTitle = "";
      i += 2;
      continue;
    }

    const sec = RE_SECTION.exec(line);
    if (sec) {
      section = `Section ${sec[1]}`;
      if (sec[2]) {
        sectionTitle = sec[2].trim();
        i += 1;
      } else {
        sectionTitle = lines[i + 1] ?? "";
        i += 2;
      }
      continue;
    }

    const head = articleHeading(line, lastArticle);
    if (head) {
      const num = head.num;
      // Strict headings carry no inline title → the title is the next line.
      let title = head.title;
      let startBody = i + 1;
      if (title === null) {
        title = lines[i + 1] ?? "";
        startBody = i + 2;
      }
      const bodyParts: string[] = [];
      if (head.inlineFirst) bodyParts.push(head.inlineFirst);
      let j = startBody;
      for (; j < lines.length; j++) {
        const bl = lines[j];
        if (
          RE_CHAPTER.test(bl) ||
          RE_SECTION.test(bl) ||
          isNextHeading(bl, num) ||
          RE_END_OF_TERMS.test(bl)
        ) {
          break;
        }
        bodyParts.push(bl);
      }
      parents.push(
        buildArticle(num, title, bodyParts.join(" "), {
          chapter,
          chapterTitle,
          section,
          sectionTitle,
        }),
      );
      lastArticle = num;
      i = j;
      continue;
    }

    i += 1; // skip stray lines (e.g. a chapter title already consumed)
  }

  return parents;
}

/** Detect an article heading. Strict "Article N" always; the inline "Article N Title…"
 *  form only when N is the next sequential article (rejects cross-references). */
function articleHeading(
  line: string,
  lastArticle: number,
): { num: number; title: string | null; inlineFirst: string } | null {
  const strict = RE_ARTICLE_STRICT.exec(line);
  if (strict) return { num: Number(strict[1]), title: null, inlineFirst: "" };

  const inline = RE_ARTICLE_INLINE.exec(line);
  if (inline && Number(inline[1]) === lastArticle + 1) {
    const num = Number(inline[1]);
    const rest = inline[2];
    // Split the inline remainder into title vs. an inline first paragraph ("… 1. …").
    const mk = /\s\d+\.\s/.exec(rest);
    if (mk) {
      return { num, title: rest.slice(0, mk.index).trim(), inlineFirst: rest.slice(mk.index).trim() };
    }
    return { num, title: rest.trim(), inlineFirst: "" };
  }
  return null;
}

/** True when `line` starts the next article — used to terminate a body scan. */
function isNextHeading(line: string, currentNum: number): boolean {
  if (RE_ARTICLE_STRICT.test(line)) return true;
  const inl = RE_ARTICLE_INLINE.exec(line);
  return !!inl && Number(inl[1]) === currentNum + 1;
}

/** Split article body text into numbered paragraphs. Sequence-aware: only accepts a
 *  "N." marker when N is the next expected paragraph, so inline runs ("… 1. … 2. …")
 *  and separate-line paragraphs parse identically, and stray "12."-style numbers in
 *  prose are ignored. Points (a)/(b) stay inline within their paragraph. */
function splitParagraphs(text: string): Array<{ num: number | null; text: string }> {
  const markers: Array<{ num: number; boundary: number; contentStart: number }> = [];
  let expected = 1;
  // Lookahead on the trailing separator so it is NOT consumed — otherwise a spurious
  // cross-reference number ("… Article 68. 5. …") would eat the space before the real
  // next marker and the scan would stall there.
  const re = /(?:^|\s)(\d+)\.(?=\s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (Number(m[1]) === expected) {
      markers.push({ num: expected, boundary: m.index, contentStart: re.lastIndex });
      expected++;
    }
  }
  if (markers.length === 0) {
    const t = text.trim();
    return t ? [{ num: null, text: t }] : [];
  }
  const preamble = text.slice(0, markers[0].boundary).trim();
  return markers.map((mk, idx) => {
    const end = idx + 1 < markers.length ? markers[idx + 1].boundary : text.length;
    let segText = text.slice(mk.contentStart, end).trim();
    if (idx === 0 && preamble) segText = `${preamble} ${segText}`;
    return { num: mk.num, text: segText };
  });
}

function buildArticle(
  num: number,
  title: string,
  bodyText: string,
  ctx: { chapter: string; chapterTitle: string; section: string; sectionTitle: string },
): ParsedParent {
  const basePath = [FRAMEWORK_NAME];
  if (ctx.chapter) basePath.push(ctx.chapter);
  if (ctx.section) basePath.push(ctx.section);
  const articlePath = [...basePath, `Article ${num}`];

  const normalized = bodyText.replace(/\s+/g, " ").trim();
  const segments = splitParagraphs(normalized);

  const children: ParsedChild[] = segments.map((seg) => {
    const hasNum = seg.num !== null;
    const label = hasNum ? `Art. ${num}(${seg.num})` : `Art. ${num}`;
    const anchor = hasNum ? `Article ${num}(${seg.num})` : `Article ${num}`;
    const path = hasNum ? [...articlePath, `(${seg.num})`] : articlePath;
    return { citation_label: label, anchor, hierarchy_path: path, text: seg.text };
  });

  const parentText = `Article ${num} — ${title}\n\n` + children.map((c) => c.text).join("\n\n");

  return {
    citation_label: `Art. ${num}`,
    anchor: `Article ${num}`,
    hierarchy_path: articlePath,
    text: parentText.trim(),
    source_url: SOURCE_URL,
    children,
  };
}

// ── Orchestrate ─────────────────────────────────────────────────────────────
export function parseGdpr(pdfPath: string): ParsedFramework {
  const raw = extractText(pdfPath);
  const lines = cleanLines(raw);
  const recitals = parseRecitals(lines);
  const articles = parseEnactingTerms(lines);
  return {
    framework_id: FRAMEWORK_ID,
    framework_name: FRAMEWORK_NAME,
    version_label: VERSION_LABEL,
    source_url: SOURCE_URL,
    source_file: "corpus/gdpr.pdf",
    parsed_at: new Date().toISOString(),
    parents: [...articles, ...recitals],
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

if (import.meta.main) {
  const pdfPath = resolve(repoRoot, "corpus/gdpr.pdf");
  const outPath = resolve(repoRoot, "corpus-build/gdpr.json");
  const parsed = parseGdpr(pdfPath);
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  const articles = parsed.parents.filter((p) => p.anchor.startsWith("Article")).length;
  const recitals = parsed.parents.filter((p) => p.anchor.startsWith("Recital")).length;
  console.log(summarize(parsed));
  console.log(`  articles: ${articles}, recitals: ${recitals}`);
  console.log(`  wrote ${outPath}`);
}
