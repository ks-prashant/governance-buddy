/**
 * Deterministic EU AI Act parser (system design §5.1–§5.3, build plan §E step 1).
 *
 * Parses corpus/eu-ai-act.pdf (Regulation (EU) 2024/1689) into its real hierarchy:
 *   Chapter → Section → Article → paragraph (→ inline points), plus Recitals and Annexes.
 *
 * Parent unit  = Article / Recital / Annex (source-viewer + generation context).
 * Child unit   = numbered paragraph (with its (a)/(b) points inline) — embedded/retrieved.
 *                For annexes, the child is a numbered area (e.g. "Annex III(5)").
 *
 * Structurally close to the GDPR parser but with Act-specific surface differences:
 *   - page furniture is "N/144", "ELI: http…", "OJ L, 12.7.2024", "EN";
 *   - chapter titles are inline ("CHAPTER I GENERAL PROVISIONS");
 *   - sections are bare ("SECTION 1") with the title on the next line;
 *   - article titles sit on their own line, with the body following separately;
 *   - Annexes I–XIII carry the high-risk-area lists cited as "Annex III(5)(b)".
 *
 * Output: corpus-build/eu_ai_act.json (committed, reviewable, NO embeddings).
 * Run: `bun ingestion/parsers/eu-ai-act.ts`
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractText } from "../lib/pdf";
import type { ParsedChild, ParsedFramework, ParsedParent } from "../types";
import { summarize } from "../types";

const FRAMEWORK_ID = "eu_ai_act";
const FRAMEWORK_NAME = "EU AI Act";
const VERSION_LABEL = "Regulation (EU) 2024/1689 — OJ L, 12.7.2024";
const SOURCE_URL = "https://eur-lex.europa.eu/eli/reg/2024/1689/oj";

// Running header/footer tokens, removed as substrings (they merge into content lines too).
const HEADER_SUBSTRINGS = [
  /ELI: http\S+/g,
  /\bOJ L, \d{1,2}\.\d{1,2}\.\d{4}\b/g,
  /\b\d{1,3}\/144\b/g, // page marker "44/144"
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

// ── Classifiers ──────────────────────────────────────────────────────────────
const RE_CHAPTER = /^CHAPTER ([IVXL]+) (.+)$/;
const RE_SECTION = /^SECTION (\d+)(?:\s+(.+))?$/;
const RE_ARTICLE_STRICT = /^Article (\d+)$/;
const RE_ARTICLE_INLINE = /^Article (\d+) (.+)$/;
const RE_RECITAL = /^\((\d+)\)\s*(.*)$/;
const RE_FOOTNOTE = /^\(\d+\)\s+OJ [CL]\b/;
const RE_END_OF_TERMS = /^(This Regulation shall be binding in its entirety|Done at Brussels)/;
const RE_ANNEX = /^ANNEX ([IVXL]+)(?:\s+(.+))?$/;

const cleanTitle = (t: string) => t.replace(/[`´'"]+\s*$/, "").trim();

// ── Recitals ─────────────────────────────────────────────────────────────────
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
    if (RE_FOOTNOTE.test(line)) continue;
    const m = RE_RECITAL.exec(line);
    if (m && Number(m[1]) === expected) {
      flush();
      const n = Number(m[1]);
      const path = [FRAMEWORK_NAME, "Recitals", `Recital ${n}`];
      current = {
        citation_label: `Recital ${n}`,
        anchor: `Recital ${n}`,
        hierarchy_path: path,
        text: m[2],
        source_url: SOURCE_URL,
        children: [{ citation_label: `Recital ${n}`, anchor: `Recital ${n}`, hierarchy_path: path, text: m[2] }],
      };
      expected++;
    } else if (current) {
      current.text += " " + line;
    }
  }
  flush();
  return parents;
}

// ── Paragraph splitting (shared shape with the GDPR parser) ───────────────────
function splitParagraphs(text: string): Array<{ num: number | null; text: string }> {
  const markers: Array<{ num: number; boundary: number; contentStart: number }> = [];
  let expected = 1;
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

/** Detect an article heading. Strict "Article N" (title on the next line) or the inline
 *  "Article N <title> [1. …]" form (only when N is sequential, rejecting cross-references).
 *  For inline headings the remainder is returned raw so parseEnactingTerms can split its
 *  title from an inline body — some articles (e.g. 64, 113) carry their whole body inline. */
function articleHeading(
  line: string,
  lastArticle: number,
): { num: number; remainder: string | null } | null {
  const strict = RE_ARTICLE_STRICT.exec(line);
  if (strict) return { num: Number(strict[1]), remainder: null };
  const inline = RE_ARTICLE_INLINE.exec(line);
  if (inline && Number(inline[1]) === lastArticle + 1) return { num: Number(inline[1]), remainder: inline[2] };
  return null;
}

function isNextHeading(line: string, currentNum: number): boolean {
  if (RE_ARTICLE_STRICT.test(line)) return true;
  const inl = RE_ARTICLE_INLINE.exec(line);
  return !!inl && Number(inl[1]) === currentNum + 1;
}

function buildArticle(
  num: number,
  title: string,
  bodyText: string,
  ctx: { chapter: string; section: string },
): ParsedParent {
  const basePath = [FRAMEWORK_NAME];
  if (ctx.chapter) basePath.push(ctx.chapter);
  if (ctx.section) basePath.push(ctx.section);
  const articlePath = [...basePath, `Article ${num}`];

  const normalized = bodyText.replace(/\s+/g, " ").trim();
  const segments = splitParagraphs(normalized);

  const children: ParsedChild[] = segments.map((seg) => {
    const hasNum = seg.num !== null;
    return {
      citation_label: hasNum ? `Art. ${num}(${seg.num})` : `Art. ${num}`,
      anchor: hasNum ? `Article ${num}(${seg.num})` : `Article ${num}`,
      hierarchy_path: hasNum ? [...articlePath, `(${seg.num})`] : articlePath,
      text: seg.text,
    };
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

// ── Enacting terms (Chapters → Sections → Articles) ───────────────────────────
function parseEnactingTerms(lines: string[]): ParsedParent[] {
  const start = lines.findIndex((l) => l === "HAVE ADOPTED THIS REGULATION:");
  if (start === -1) throw new Error("Could not locate 'HAVE ADOPTED THIS REGULATION:'");

  const parents: ParsedParent[] = [];
  let chapter = "";
  let section = "";
  let lastArticle = 0;

  let i = start + 1;
  while (i < lines.length) {
    const line = lines[i];
    if (RE_END_OF_TERMS.test(line) || RE_ANNEX.test(line)) break;

    const chap = RE_CHAPTER.exec(line);
    if (chap) {
      chapter = `Chapter ${chap[1]} (${cleanTitle(chap[2])})`;
      section = "";
      i += 1;
      continue;
    }

    const sec = RE_SECTION.exec(line);
    if (sec) {
      const title = sec[2] ? cleanTitle(sec[2]) : cleanTitle(lines[i + 1] ?? "");
      section = `Section ${sec[1]} (${title})`;
      i += sec[2] ? 1 : 2;
      continue;
    }

    const head = articleHeading(line, lastArticle);
    if (head) {
      const num = head.num;
      // Resolve title + any inline body from the heading remainder.
      let title = "";
      let inlineBody = "";
      let startBody = i + 1;
      if (head.remainder === null) {
        title = cleanTitle(lines[i + 1] ?? ""); // strict heading: title on the next line
        startBody = i + 2;
      } else {
        // Inline "Article N <title> [1. body …]": split at the first paragraph marker.
        const mk = /(?:^|\s)1\.\s/.exec(head.remainder);
        if (mk) {
          title = cleanTitle(head.remainder.slice(0, mk.index));
          inlineBody = head.remainder.slice(mk.index).trim();
        } else {
          title = cleanTitle(head.remainder);
        }
      }
      const bodyParts: string[] = inlineBody ? [inlineBody] : [];
      let j = startBody;
      for (; j < lines.length; j++) {
        const bl = lines[j];
        if (RE_CHAPTER.test(bl) || RE_SECTION.test(bl) || isNextHeading(bl, num) || RE_END_OF_TERMS.test(bl) || RE_ANNEX.test(bl)) break;
        bodyParts.push(bl);
      }
      // Fallback: an inline article whose unnumbered body sits entirely in the remainder
      // (e.g. Article 113) leaves bodyParts empty — use the remainder as the body so the
      // article still has a child, and keep the title to a short prefix.
      if (bodyParts.length === 0 && head.remainder) {
        bodyParts.push(head.remainder);
        title = cleanTitle(head.remainder.split(/\s+/).slice(0, 6).join(" "));
      }
      parents.push(buildArticle(num, title, bodyParts.join(" "), { chapter, section }));
      lastArticle = num;
      i = j;
      continue;
    }

    i += 1; // stray line (already-consumed title, etc.)
  }
  return parents;
}

// ── Annexes ───────────────────────────────────────────────────────────────────
function parseAnnexes(lines: string[]): ParsedParent[] {
  const parents: ParsedParent[] = [];
  const starts: Array<{ roman: string; title: string; i: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = RE_ANNEX.exec(lines[i]);
    if (m) starts.push({ roman: m[1], title: cleanTitle(m[2] ?? ""), i });
  }
  if (starts.length === 0) return parents;

  for (let a = 0; a < starts.length; a++) {
    const { roman, title, i } = starts[a];
    const end = a + 1 < starts.length ? starts[a + 1].i : lines.length;
    // The title may be on the annex line or the next line; the body follows.
    let bodyStart = i + 1;
    let annexTitle = title;
    if (!annexTitle && bodyStart < end) {
      annexTitle = cleanTitle(lines[bodyStart]);
      bodyStart += 1;
    }
    const body = lines.slice(bodyStart, end).join(" ").replace(/\s+/g, " ").trim();
    if (!body) continue;

    const annexPath = [FRAMEWORK_NAME, "Annexes", `Annex ${roman}`];
    const areas = splitParagraphs(body).filter((seg) => seg.text.trim().length > 0);
    const children: ParsedChild[] = areas.map((seg) => {
      const hasNum = seg.num !== null;
      return {
        citation_label: hasNum ? `Annex ${roman}(${seg.num})` : `Annex ${roman}`,
        anchor: hasNum ? `Annex ${roman}(${seg.num})` : `Annex ${roman}`,
        hierarchy_path: hasNum ? [...annexPath, `(${seg.num})`] : annexPath,
        text: seg.text,
      };
    });
    // De-dupe a single unnumbered child sharing the parent's label (keeps labels unique).
    if (children.length === 1 && children[0].anchor === `Annex ${roman}`) {
      children[0].citation_label = `Annex ${roman} (text)`;
      children[0].anchor = `Annex ${roman} (text)`;
    }

    parents.push({
      citation_label: `Annex ${roman}`,
      anchor: `Annex ${roman}`,
      hierarchy_path: annexPath,
      text: `Annex ${roman} — ${annexTitle}\n\n` + children.map((c) => c.text).join("\n\n"),
      source_url: SOURCE_URL,
      children,
    });
  }
  return parents;
}

// ── Orchestrate ───────────────────────────────────────────────────────────────
export function parseEuAiAct(pdfPath: string): ParsedFramework {
  const lines = cleanLines(extractText(pdfPath));
  const recitals = parseRecitals(lines);
  const articles = parseEnactingTerms(lines);
  const annexes = parseAnnexes(lines);
  return {
    framework_id: FRAMEWORK_ID,
    framework_name: FRAMEWORK_NAME,
    version_label: VERSION_LABEL,
    source_url: SOURCE_URL,
    source_file: "corpus/eu-ai-act.pdf",
    parsed_at: new Date().toISOString(),
    parents: [...articles, ...annexes, ...recitals],
  };
}

// ── CLI ────────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

if (import.meta.main) {
  const pdfPath = resolve(repoRoot, "corpus/eu-ai-act.pdf");
  const outPath = resolve(repoRoot, "corpus-build/eu_ai_act.json");
  const parsed = parseEuAiAct(pdfPath);
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  const articles = parsed.parents.filter((p) => p.anchor.startsWith("Article")).length;
  const annexes = parsed.parents.filter((p) => p.anchor.startsWith("Annex")).length;
  const recitals = parsed.parents.filter((p) => p.anchor.startsWith("Recital")).length;
  console.log(summarize(parsed));
  console.log(`  articles: ${articles}, annexes: ${annexes}, recitals: ${recitals}`);
  console.log(`  wrote ${outPath}`);
}
