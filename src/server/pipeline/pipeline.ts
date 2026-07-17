/**
 * Orchestrator (system design §8; build plan §D step 4).
 *
 * The full request path as a staged, event-emitting async generator:
 *   understand → [clarify?] → retrieve → [refuse?] → generate (Step A) →
 *   validate (Step B) → [empty?] → assemble → result.
 *
 * Emitting events (rather than returning one blob) is what makes streaming
 * structural: the SSE endpoint pipes these events to the browser as they occur
 * (restated understanding early, stage names as work runs, the map when ready),
 * and non-streaming callers (the eval harness) collect the same events into a
 * final answer. One pipeline, both transports — no second response shape to build.
 *
 * Every terminal path resolves to exactly one of: a grounded result, a clarifying
 * question, a refusal, an honest empty state, or an error (system design §15) —
 * never a fabricated partial answer.
 *
 * SERVER-ONLY.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { RETRIEVAL } from "./config";
import { understand } from "./understand";
import {
  getActiveSnapshotId,
  runRetrieval,
  type RerankedCandidate,
  type ParentGroup,
} from "./retrieve";
import { generateObligationMap, type GenerationSource } from "./generate";
import { validateObligations, type ChunkTextLookup } from "./validate";
import { assemble, type ChunkMeta, type AssembledResult } from "./assemble";

const FRAMEWORK_NAMES: Record<string, string> = {
  gdpr: "GDPR",
  eu_ai_act: "EU AI Act",
  nist_ai_rmf: "NIST AI RMF",
  nist_csf: "NIST CSF 2.0",
  nist_ssdf: "NIST SSDF",
};
const fwName = (id: string) => FRAMEWORK_NAMES[id] ?? id;

export type PipelineEvent =
  | { type: "understanding"; input_type: string; restated_understanding?: string }
  | { type: "stage"; label: string }
  | { type: "clarify"; question: string; missing_attribute?: string }
  | { type: "refusal"; message: string }
  | { type: "empty"; message: string; gaps: string[] }
  | { type: "result"; result: AssembledResult }
  | { type: "error"; message: string }
  | { type: "done" };

const REFUSAL_MESSAGE =
  "Nothing in the current corpus clearly addresses this. The corpus covers a fixed set of " +
  "governance frameworks; this question appears to fall outside them. Try rephrasing, or " +
  "consult a qualified professional for questions beyond these sources.";

const EMPTY_MESSAGE =
  "Nothing in the current corpus clearly applies to this. Rather than guess, the assistant is " +
  "flagging that its sources don't support a confident answer here.";

async function getSnapshotDate(db: SupabaseClient, snapshotId: string): Promise<string> {
  const { data } = await db
    .from("corpus_snapshots")
    .select("snapshot_date")
    .eq("id", snapshotId)
    .single();
  return (data?.snapshot_date as string) ?? "unknown";
}

/** Build the generation sources (parents + citeable children) and the metadata/score
 *  lookups the rest of the pipeline needs, from the retrieval output. */
function buildSources(reranked: RerankedCandidate[], parents: ParentGroup[]) {
  const parentById = new Map(parents.map((p) => [p.parent_id, p]));
  const childrenByParent = new Map<string, RerankedCandidate[]>();
  for (const c of reranked) {
    const list = childrenByParent.get(c.parent_id) ?? [];
    list.push(c);
    childrenByParent.set(c.parent_id, list);
  }

  const sources: GenerationSource[] = [];
  const chunkMeta: Map<string, ChunkMeta> = new Map();
  const chunkText: ChunkTextLookup = new Map();
  const rerankScore = new Map<string, number>();

  for (const [parentId, children] of childrenByParent) {
    const parent = parentById.get(parentId);
    if (!parent) continue;
    const framework = fwName(parent.framework_id);
    sources.push({
      framework,
      parent_citation_label: parent.citation_label,
      hierarchy_path: parent.hierarchy_path,
      parent_text: parent.text,
      chunks: children.map((c) => ({ chunk_id: c.id, citation_label: c.citation_label, text: c.text })),
    });
    for (const c of children) {
      chunkMeta.set(c.id, {
        framework,
        citation_label: c.citation_label,
        hierarchy_path: c.hierarchy_path,
        source_url: parent.source_url,
      });
      chunkText.set(c.id, { citation_label: c.citation_label, text: c.text });
      rerankScore.set(c.id, c.rerankScore);
    }
  }

  return { sources, chunkMeta, chunkText, rerankScore };
}

export async function* runPipeline(
  db: SupabaseClient,
  input: string,
  opts: { frameworkId?: string } = {},
): AsyncGenerator<PipelineEvent> {
  // 1. Understand (cheap, fast) — and the snapshot lookup, in parallel.
  const [understanding, snapshotId] = await Promise.all([
    understand(input),
    getActiveSnapshotId(db),
  ]);

  if (understanding.input_type === "system_description" && !understanding.sufficient) {
    yield {
      type: "clarify",
      question:
        understanding.clarifying_question ??
        "Could you tell me a bit more about what the system does, what data it uses, and where it's deployed?",
      missing_attribute: understanding.missing_attribute,
    };
    yield { type: "done" };
    return;
  }

  yield {
    type: "understanding",
    input_type: understanding.input_type,
    restated_understanding: understanding.restated_understanding,
  };

  // 2. Retrieve.
  yield { type: "stage", label: "Retrieving relevant clauses…" };
  const { reranked, parents } = await runRetrieval(db, understanding, input, {
    snapshotId,
    frameworkId: opts.frameworkId,
  });

  // Relevance gate: if nothing clears the floor, refuse rather than generate from thin
  // material (system design §7.3, §15). Citation-pinned matches score 1, so a question
  // that explicitly names an in-corpus clause won't be wrongly refused.
  const topScore = reranked.reduce((m, c) => Math.max(m, c.rerankScore), 0);
  if (reranked.length === 0 || topScore < RETRIEVAL.relevanceFloor) {
    yield { type: "refusal", message: REFUSAL_MESSAGE };
    yield { type: "done" };
    return;
  }

  const snapshotDate = await getSnapshotDate(db, snapshotId);
  const { sources, chunkMeta, chunkText, rerankScore } = buildSources(reranked, parents);
  const retrievedContext = sources
    .map((s) => `${s.framework} ${s.parent_citation_label}: ${s.parent_text.replace(/\n+/g, " ")}`)
    .join("\n\n");

  // 3. Generate (Step A) — the obligation map, grounded to the supplied sources.
  yield { type: "stage", label: "Mapping obligations…" };
  const { map } = await generateObligationMap({
    input,
    inputType: understanding.input_type,
    restatedUnderstanding: understanding.restated_understanding,
    sources,
  });

  // 4. Validate (Step B) — drop any obligation whose statement isn't entailed by its source.
  yield { type: "stage", label: "Verifying every claim against its source…" };
  const { kept } = await validateObligations(map.obligations, chunkText);

  if (kept.length === 0) {
    yield { type: "empty", message: EMPTY_MESSAGE, gaps: map.gaps };
    yield { type: "done" };
    return;
  }

  // 5. Assemble — tiers, citation payloads from trusted metadata, framing.
  const result = assemble({
    restatedUnderstanding: understanding.restated_understanding,
    obligations: kept,
    gaps: map.gaps,
    overallConfidence: map.overall_confidence,
    chunkMeta,
    rerankScore,
    snapshotDate,
    retrievedContext,
  });

  yield { type: "result", result };
  yield { type: "done" };
}

/** Collect the event stream into the flat shape the eval harness grades
 *  ({text, citations, retrievedContext}) — the non-streaming view of the same run. */
export interface CollectedResult {
  behavior: "answer" | "refuse" | "clarify" | "empty" | "error";
  text: string;
  citations: Array<{ framework: string; anchor: string }>;
  retrievedContext: string;
  restated_understanding?: string;
}

export async function collectPipeline(
  db: SupabaseClient,
  input: string,
  opts: { frameworkId?: string } = {},
): Promise<CollectedResult> {
  let restated: string | undefined;
  try {
    for await (const ev of runPipeline(db, input, opts)) {
      switch (ev.type) {
        case "understanding":
          restated = ev.restated_understanding;
          break;
        case "clarify":
          return { behavior: "clarify", text: ev.question, citations: [], retrievedContext: "", restated_understanding: restated };
        case "refusal":
          return { behavior: "refuse", text: ev.message, citations: [], retrievedContext: "" };
        case "empty":
          return {
            behavior: "empty",
            text: `${ev.message}${ev.gaps.length ? "\nGaps: " + ev.gaps.join("; ") : ""}`,
            citations: [],
            retrievedContext: "",
          };
        case "result":
          return {
            behavior: "answer",
            text: ev.result.text,
            citations: ev.result.citations,
            retrievedContext: ev.result.retrievedContext,
            restated_understanding: restated,
          };
      }
    }
    return { behavior: "error", text: "Pipeline produced no result.", citations: [], retrievedContext: "" };
  } catch (err) {
    return {
      behavior: "error",
      text: err instanceof Error ? err.message : String(err),
      citations: [],
      retrievedContext: "",
    };
  }
}
