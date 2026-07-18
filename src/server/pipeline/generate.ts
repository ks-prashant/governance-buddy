/**
 * Step A — grounded obligation-map generation (system design §7.1, build plan §D).
 *
 * Opus, structured output via a forced tool call, given ONLY the retrieved source
 * clauses. Returns obligations (each citing chunk_ids from the supplied set), honest
 * gaps, and an overall confidence. The grounding fence — `supporting_chunk_ids` must
 * come from the provided set — is enforced both by the prompt and, mechanically, by
 * filtering the model's output against the known id set here; Step B (validate.ts)
 * then checks entailment. Nothing the model emits with an unknown/invented id survives.
 *
 * Design note on thinking: this first version uses a FORCED tool call and NO extended
 * thinking (the two are API-incompatible — §4.5). The grounding backstop is Step B, so
 * reliable structure now + validation next is the right order; add thinking here only
 * if the groundedness gate isn't met without it.
 *
 * SERVER-ONLY. Reads ANTHROPIC_API_KEY (via llm()).
 */
import { z } from "zod";
import { llm, type LlmTool } from "./llm";
import { MODELS, GENERATION } from "./config";

/** A single citeable unit handed to the model (a retrieved child chunk). */
export interface CiteableChunk {
  chunk_id: string;
  citation_label: string;
  text: string;
}

/** A source article/section: full parent text for context + its citeable child chunks. */
export interface GenerationSource {
  framework: string;
  parent_citation_label: string;
  hierarchy_path: string[];
  parent_text: string;
  chunks: CiteableChunk[];
}

export const APPLICABILITY = ["Direct", "Inferred", "Possible"] as const;
export const IMPACT = ["high", "medium", "low"] as const;

const ObligationSchema = z.object({
  statement: z.string().min(1),
  rationale: z.string().min(1),
  // No .min(1) here: if the model ever emits ONE obligation with zero/invalid chunk
  // ids (violating the "one or more" prompt instruction, which isn't a hard JSON-schema
  // constraint), a strict min(1) would fail parsing the ENTIRE response and crash the
  // whole request. The existing post-fence filter below already drops any obligation
  // left with zero valid ids after checking against the known set — let that mechanism
  // do the job instead of a zod-level constraint that aborts everything on one bad item.
  supporting_chunk_ids: z.array(z.string()),
  applicability: z.enum(APPLICABILITY),
  impact: z.enum(IMPACT),
  conflicts_with: z.string().optional(),
});

const ObligationMapSchema = z.object({
  obligations: z.array(ObligationSchema),
  // Coerce a lone string to a one-element array: observed in practice under forced
  // tool-use (the model occasionally emits gaps as a plain string instead of an array
  // when there's exactly one gap) — matches this file's existing philosophy of not
  // crashing the whole response over one field's shape drift (see supporting_chunk_ids
  // above). A raw .parse() failure here previously surfaced as a bare ZodError message
  // to the user via collectPipeline's catch-all.
  gaps: z.preprocess((v) => (typeof v === "string" ? [v] : v), z.array(z.string())),
  overall_confidence: z.enum(["high", "medium", "low"]),
});

export type Obligation = z.infer<typeof ObligationSchema>;
export type ObligationMap = z.infer<typeof ObligationMapSchema>;

const TOOL_NAME = "emit_obligation_map";

const TOOL: LlmTool = {
  name: TOOL_NAME,
  description:
    "Emit the grounded obligation map: the obligations that apply, each cited to the " +
    "provided source chunk_ids, plus honest gaps and an overall confidence.",
  input_schema: {
    type: "object",
    properties: {
      obligations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            statement: {
              type: "string",
              description:
                "The obligation or point in plain language, sourced not asserted " +
                "(e.g. 'GDPR Article 22 gives individuals the right not to be subject to " +
                "a solely automated decision with legal or similarly significant effect'). " +
                "Must be fully supported by the cited source text. Never a compliance verdict.",
            },
            rationale: {
              type: "string",
              description:
                "Why this applies to the described system / answers the question, " +
                "referencing the input's attributes. Framing only — the substantive " +
                "governance content lives in `statement` and must be cited.",
            },
            supporting_chunk_ids: {
              type: "array",
              items: { type: "string" },
              description:
                "One or more chunk_ids taken VERBATIM from the provided sources whose text " +
                "supports `statement`. Never invent an id; never cite text you weren't given.",
            },
            applicability: {
              type: "string",
              enum: [...APPLICABILITY],
              description:
                "Direct: a cited clause plainly matches the input's attributes. Inferred: " +
                "applies via reasonable inference. Possible: tangential, flagged for review.",
            },
            impact: {
              type: "string",
              enum: [...IMPACT],
              description:
                "How consequential the obligation is (obligations governing automated " +
                "decisions about people rank higher).",
            },
            conflicts_with: {
              type: "string",
              description:
                "chunk_id of a source clause that pulls in a different direction for this " +
                "input. Set only for a genuine tension; do not resolve it. Omit otherwise.",
            },
          },
          required: ["statement", "rationale", "supporting_chunk_ids", "applicability", "impact"],
        },
      },
      gaps: {
        type: "array",
        items: { type: "string" },
        description:
          "What the provided sources do NOT clearly address for this input. Be specific and " +
          "honest — a stated gap is better than a filled one. Empty array if none.",
      },
      overall_confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Overall confidence that the provided sources let you map this input well.",
      },
    },
    required: ["obligations", "gaps", "overall_confidence"],
  },
};

const SYSTEM_PROMPT = `You are the grounded-generation stage of Grounded Governance, a research
assistant that maps a described AI system (or answers a direct question) to the governance
obligations that apply — drawn ONLY from the source clauses provided in the user message.

Absolute rules. Violating any one is a critical failure:
1. GROUND EVERYTHING. Every obligation's \`statement\` must be fully supported by the text of the
   source chunk(s) you cite for it. Never state a governance fact that isn't in the provided
   sources — not from your own knowledge of law or frameworks. If the sources don't support a
   point, do not make it; put it in \`gaps\` instead.
2. CITE ONLY PROVIDED CHUNK IDS. Every id in \`supporting_chunk_ids\` must be a chunk_id that
   appears verbatim in the provided sources. Never invent a chunk_id, article number, or citation.
3. NEVER STATE A VERDICT. Do not say or imply the system is "compliant", "non-compliant",
   "legal", "illegal", "safe", "covered", or "fine". You report what frameworks require; you
   never judge whether the user has met them. Prefer "GDPR Article X requires…" over "you must…".
4. HONEST GAPS. If the sources don't clearly address something relevant to the input, name it in
   \`gaps\` rather than filling it. An honest gap is a feature.
5. APPLICABILITY: label each obligation Direct / Inferred / Possible per the schema.
6. CONFLICTS: if two provided clauses genuinely pull in different directions for this input, set
   \`conflicts_with\`; present both, resolve neither.
7. DON'T ANSWER A DIFFERENT QUESTION THAN WAS ASKED — but DO correct a false premise when you
   have the real source for it. Two different situations, handled differently:
   (a) REGIME GENUINELY ABSENT: the input's core subject is a SPECIFIC named standard, law, or
       regime (e.g. "ISO/IEC 42001", "ISO 27001", "UK GDPR", "CCPA", "HIPAA") and NONE of the
       provided sources are that regime's own text — even if the sources include material from
       a DIFFERENT, textually-similar-sounding regime (e.g. the provided GDPR's own
       certification articles, when asked about ISO certification; EU GDPR text, when asked
       about UK GDPR). Do NOT manufacture obligations by generalizing from that adjacent
       material as if it answered the question. Return an EMPTY \`obligations\` array and use
       \`gaps\` to say plainly that the specific thing asked about is not among the provided
       sources, distinguishing it from whatever similar-sounding in-corpus material exists
       (name it, so the user isn't left with nothing, but don't present it as an answer to what
       they actually asked).
   (b) FALSE PREMISE, BUT THE REAL SOURCE IS PROVIDED: the question assumes something false
       about a clause or framework, but the provided sources DO include the material that's
       actually relevant — e.g. it asks what a specific named article says about a topic that
       article doesn't actually cover, or asks you to cite a provision in framework X that
       doesn't exist there when the real rule lives in framework Y and Y's text is among your
       sources. This IS answerable — it is not a gap. Produce an obligation that cites the
       ACTUAL relevant clause, states ONLY what it actually says (grounded per rule 1), and
       explicitly corrects the premise in the \`statement\` or \`rationale\` (e.g. "GDPR Article
       99 concerns the Regulation's entry into force; it does not address AI training data" or
       "GDPR Article 33(1) — not the EU AI Act — is the source of the 72-hour breach-
       notification rule"). An honest, cited correction is a more complete answer than an
       empty gap — use (b), not (a), whenever the sources contain the clause the correction
       depends on.

For a system_description, produce the obligations that apply to THAT system, each rationale tying
it to the described attributes. For a direct_question, produce the point(s) that answer the
question, each cited. Lead with plain language; the precise legal text lives in the cited source.

Call the ${TOOL_NAME} tool exactly once.`;

function renderSources(sources: GenerationSource[]): string {
  return sources
    .map((s, i) => {
      const chunkLines = s.chunks
        .map((c) => `    - chunk_id: ${c.chunk_id}  |  ${c.citation_label}\n      ${c.text}`)
        .join("\n");
      return (
        `[SOURCE ${i + 1}] ${s.framework} — ${s.parent_citation_label}\n` +
        `  Full text (context):\n  ${s.parent_text.replace(/\n+/g, " ")}\n` +
        `  Citeable units (cite these chunk_ids):\n${chunkLines}`
      );
    })
    .join("\n\n");
}

export interface GenerateResult {
  map: ObligationMap;
  /** chunk_ids that the model cited but that weren't in the supplied set (dropped). */
  droppedInventedIds: string[];
  usage: unknown;
}

export async function generateObligationMap(args: {
  input: string;
  inputType: "system_description" | "direct_question";
  restatedUnderstanding?: string;
  sources: GenerationSource[];
}): Promise<GenerateResult> {
  const validIds = new Set(args.sources.flatMap((s) => s.chunks.map((c) => c.chunk_id)));

  const userMessage =
    `INPUT TYPE: ${args.inputType}\n` +
    (args.restatedUnderstanding ? `RESTATED UNDERSTANDING: ${args.restatedUnderstanding}\n` : "") +
    `USER INPUT: ${args.input}\n\n` +
    `SOURCES (the ONLY material you may use):\n\n${renderSources(args.sources)}`;

  // Retry once on a malformed tool call. Observed live (Sonnet 5, forced tool-use): the
  // model occasionally emits an internally-inconsistent shape for a hard prompt — not just
  // one field off (a lone string for `gaps`), but `obligations` itself as a string with
  // `gaps`/`overall_confidence` missing entirely. This is evidence of a bad sample, not a
  // systematic schema problem — after fixing three separate single-field cases in one
  // session, retrying the whole call once is the more durable fix than chasing every
  // possible malformed shape field-by-field. A second failure is a real error and should
  // still surface as one (handled by collectPipeline's catch-all).
  let parsed: ObligationMap | undefined;
  let usage: unknown;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const result = await llm({
      model: MODELS.generate,
      system: [
        // Stable, cacheable prefix — the rules + schema instructions never vary per request.
        { type: "text", text: SYSTEM_PROMPT, ...(GENERATION.cacheSystemPrefix ? { cache_control: { type: "ephemeral" } } : {}) },
      ],
      messages: [{ role: "user", content: userMessage }],
      maxTokens: GENERATION.maxTokens,
      tools: [TOOL],
      toolChoice: { type: "tool", name: TOOL_NAME },
    });

    const call = result.toolUses.find((t) => t.name === TOOL_NAME);
    if (!call) {
      lastErr = new Error(`generate: model did not call ${TOOL_NAME} (stop_reason=${result.stopReason})`);
      continue;
    }
    try {
      parsed = ObligationMapSchema.parse(call.input);
      usage = result.usage;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!parsed) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));

  // Grounding fence (mechanical): drop any cited id not in the supplied set, then drop
  // any obligation left with no valid citation. Invented ids can never reach the user.
  // conflicts_with gets the same treatment — it's still a citation-shaped id from the
  // model, not exempt from the "only ids we actually supplied" invariant just because
  // it isn't the primary citation.
  const droppedInventedIds: string[] = [];
  const fenced = parsed.obligations
    .map((o) => {
      const valid = o.supporting_chunk_ids.filter((id) => validIds.has(id));
      for (const id of o.supporting_chunk_ids) if (!validIds.has(id)) droppedInventedIds.push(id);
      const conflictsWith =
        o.conflicts_with && validIds.has(o.conflicts_with) ? o.conflicts_with : undefined;
      if (o.conflicts_with && !conflictsWith) droppedInventedIds.push(o.conflicts_with);
      return { ...o, supporting_chunk_ids: valid, conflicts_with: conflictsWith };
    })
    .filter((o) => o.supporting_chunk_ids.length > 0);

  return {
    map: { ...parsed, obligations: fenced },
    droppedInventedIds,
    usage,
  };
}
