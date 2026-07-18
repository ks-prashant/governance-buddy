/**
 * Deterministic NIST SSDF (SP 800-218 v1.1) parser (system design §5.1–§5.3, build plan §E step 1).
 *
 * Parses corpus/nist-ssdf.pdf's practice table into its real hierarchy:
 *   Practice group (PO/PS/PW/RV) → Practice (e.g. "PO.1") → Task (e.g. "PW.4.1")
 *
 * Parent unit  = Practice (source-viewer + generation-context unit).
 * Child unit   = Task (embedded/retrieved) — the smallest actionable unit.
 * Practice group is derived from the id prefix and carried in the hierarchy_path.
 *
 * The build plan flags SSDF as the messy one: its Table 1 is a 3-column layout
 * (Tasks | Notional Implementation Examples | References) that pdftotext flattens,
 * interleaving each practice's task list with long "Example N: …" prose and dense
 * cross-reference lines ("BSAFSS: … BSIMM: …"). Worse, page breaks collapse adjacent
 * headers onto one line ("… (PW.3): Moved to PW.4 … (PW.4): …") and merge a group
 * header into its first practice ("Respond to Vulnerabilities (RV) Identify … (RV.1): …").
 *
 * So we DON'T rely on line structure. We tokenize the whole table by the stable id
 * shapes — practice headers "(XX.N):" and task ids "XX.N.M:" — and cut each unit's text
 * at the "Notional Implementation Examples"/"References" column markers so none of the
 * example/reference prose leaks into a task. Each practice id occurs exactly once in the
 * document, so this is collision-free without needing an explicit end-of-table bound.
 *
 * Crucially, pdftotext emits each PAGE column-first: ALL of a page's practice headers,
 * then ALL of their tasks batched together, then the examples, then the references. So a
 * task is assigned to its practice by its ID PREFIX ("PW.4.1" → "PW.4"), never by reading
 * position — position would misfile every task after the first practice on a page. Tasks
 * that are deprecated redirects ("PW.3.1: Moved to PO.1.3") are dropped.
 *
 * Output: corpus-build/nist_ssdf.json (committed, reviewable, NO embeddings).
 * Run: `bun ingestion/parsers/nist-ssdf.ts`
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { extractText } from "../lib/pdf";
import type { ParsedChild, ParsedFramework, ParsedParent } from "../types";
import { summarize } from "../types";

const FRAMEWORK_ID = "nist_ssdf";
const FRAMEWORK_NAME = "NIST SSDF";
const VERSION_LABEL = "NIST SP 800-218 — Secure Software Development Framework (SSDF) Version 1.1";
const SOURCE_URL = "https://doi.org/10.6028/NIST.SP.800-218";

const GROUP_NAMES: Record<string, string> = {
  PO: "Prepare the Organization (PO)",
  PS: "Protect the Software (PS)",
  PW: "Produce Well-Secured Software (PW)",
  RV: "Respond to Vulnerabilities (RV)",
};

// Page furniture and column markers that must not bleed into unit text.
const RE_FURNITURE = [
  /^\d{1,3}$/,
  /^NIST SP 800-218$/,
  /^SSDF VERSION 1\.1$/,
  /^Practices$/,
  /^Tasks$/,
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

interface Marker {
  idx: number;
  contentStart: number;
}
interface PracticeMarker extends Marker {
  name: string;
  gid: string;
  pid: string;
}
interface TaskMarker extends Marker {
  tid: string;
}

/** Earliest cut position (a column marker) at or after `from`, else `fallback`. */
function nextCut(cuts: number[], from: number, fallback: number): number {
  for (const c of cuts) if (c >= from) return Math.min(c, fallback);
  return fallback;
}

export function parseNistSsdf(pdfPath: string): ParsedFramework {
  const raw = extractText(pdfPath);
  const S = cleanLines(raw).join(" ");

  // Practice headers: "<name> (XX.N):". The name excludes parens so a collapsed
  // "…(PW.3): Moved to PW.4 … (PW.4): …" still yields two separate practices.
  const practiceRe = /([A-Za-z][A-Za-z0-9 ,'’&/-]*?) \((PO|PS|PW|RV)\.(\d+)\):/g;
  const practices: PracticeMarker[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = practiceRe.exec(S))) {
    practices.push({
      name: pm[1].trim(),
      gid: pm[2],
      pid: `${pm[2]}.${pm[3]}`,
      idx: pm.index,
      contentStart: practiceRe.lastIndex,
    });
  }

  const taskRe = /(PO|PS|PW|RV)\.(\d+)\.(\d+):/g;
  const tasks: TaskMarker[] = [];
  let tm: RegExpExecArray | null;
  while ((tm = taskRe.exec(S))) {
    tasks.push({ tid: `${tm[1]}.${tm[2]}.${tm[3]}`, idx: tm.index, contentStart: taskRe.lastIndex });
  }

  // Column markers that bound a unit's text. "Example N:" is included because on some
  // pages the per-task example prose follows a task directly, without a repeated
  // "Notional Implementation Examples" header — task definitions never contain that shape.
  const cutRe = /Notional Implementation Examples|References|Example \d+:/g;
  const cuts: number[] = [];
  let cm: RegExpExecArray | null;
  while ((cm = cutRe.exec(S))) cuts.push(cm.index);

  // Task text is sliced globally (task → next task / column marker), then the task is
  // filed under the practice named by its id prefix ("PW.4.1" → "PW.4"). Deprecated
  // "Moved to …" redirect tasks carry no real content and are dropped.
  const childrenByPid = new Map<string, ParsedChild[]>();
  for (let j = 0; j < tasks.length; j++) {
    const t = tasks[j];
    const end = nextCut(cuts, t.contentStart, j + 1 < tasks.length ? tasks[j + 1].idx : S.length);
    const text = S.slice(t.contentStart, end).replace(/\s+/g, " ").trim();
    if (/^Moved to\b/i.test(text)) continue;
    const parentPid = t.tid.replace(/\.\d+$/, "");
    const list = childrenByPid.get(parentPid) ?? [];
    list.push({ citation_label: t.tid, anchor: t.tid, hierarchy_path: [], text: `${t.tid}: ${text}` });
    childrenByPid.set(parentPid, list);
  }

  const parents: ParsedParent[] = [];
  const seenPid = new Set<string>();
  for (let i = 0; i < practices.length; i++) {
    const p = practices[i];
    if (seenPid.has(p.pid)) continue; // each practice id is unique in the doc; guard anyway
    seenPid.add(p.pid);

    const children = childrenByPid.get(p.pid);
    if (!children || children.length === 0) continue; // skip deprecated/merged practices (e.g. PW.3)

    const groupName = GROUP_NAMES[p.gid];
    const practicePath = [FRAMEWORK_NAME, groupName, `${p.name} (${p.pid})`];
    for (const c of children) c.hierarchy_path = [...practicePath, c.citation_label];

    // Description = text after this header up to the next practice header / task / column marker,
    // with a trailing "Tasks" column label (from a page where the batch starts mid-line) stripped.
    const nextHeader = i + 1 < practices.length ? practices[i + 1].idx : S.length;
    const firstTask = tasks.find((t) => t.idx >= p.contentStart);
    const descEnd = Math.min(
      nextHeader,
      firstTask ? firstTask.idx : S.length,
      nextCut(cuts, p.contentStart, S.length),
    );
    const desc = S.slice(p.contentStart, descEnd).replace(/\s+Tasks\s*$/, "").replace(/\s+/g, " ").trim();

    const parentText =
      `${p.name} (${p.pid}): ${desc}`.trim() + "\n\n" + children.map((c) => c.text).join("\n");
    parents.push({
      citation_label: p.pid,
      anchor: p.pid,
      hierarchy_path: practicePath,
      text: parentText.trim(),
      source_url: SOURCE_URL,
      children,
    });
  }

  return {
    framework_id: FRAMEWORK_ID,
    framework_name: FRAMEWORK_NAME,
    version_label: VERSION_LABEL,
    source_url: SOURCE_URL,
    source_file: "corpus/nist-ssdf.pdf",
    parsed_at: new Date().toISOString(),
    parents,
  };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

if (import.meta.main) {
  const pdfPath = resolve(repoRoot, "corpus/nist-ssdf.pdf");
  const outPath = resolve(repoRoot, "corpus-build/nist_ssdf.json");
  const parsed = parseNistSsdf(pdfPath);
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  console.log(summarize(parsed));
  const byGroup = new Map<string, number>();
  for (const p of parsed.parents) {
    const g = p.hierarchy_path[1] ?? "?";
    byGroup.set(g, (byGroup.get(g) ?? 0) + 1);
  }
  for (const [g, n] of byGroup) console.log(`  ${g}: ${n} practices`);
  console.log(`  wrote ${outPath}`);
}
