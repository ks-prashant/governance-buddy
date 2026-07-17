/**
 * Query understanding — one cheap Haiku call doing classification + sufficiency +
 * decomposition together (system design §6.1, build plan §C step 1).
 *
 * Returns whether the input is a system description or a direct question, whether
 * a system description supplies enough to map reliably (PRD §8.2 — function, data,
 * decision-impact-on-people, deployment region), and a set of retrieval sub-queries.
 *
 * Phase C note: only GDPR is loaded, so subqueries are prompted for RECALL
 * (paraphrase/expand), not full five-dimension fan-out — that lands in Phase 4
 * (build plan §E) once all five frameworks are ingested. The `dimension` field is
 * already part of the shape so Phase 4 only changes the prompt, not the schema.
 */
import { z } from "zod";
import { llm, type LlmTool } from "./llm";
import { MODELS } from "./config";

export const DIMENSIONS = [
  "privacy",
  "ai_regulation",
  "ai_risk",
  "cybersecurity",
  "secure_development",
] as const;

const SubqueneSchema = z.object({
  dimension: z.enum(DIMENSIONS),
  query: z.string().min(1),
});

const UnderstandingSchema = z.object({
  input_type: z.enum(["system_description", "direct_question"]),
  sufficient: z.boolean(),
  missing_attribute: z.string().optional(),
  clarifying_question: z.string().optional(),
  /** For a system_description: a one-sentence restatement of what the system is,
   *  shown to the user as the "here's what I understood" trust checkpoint (PRD §6.1
   *  Step 4). Produced here (cheap Haiku) rather than in the expensive Opus step so it
   *  can stream to the user immediately, before generation runs. Omitted for a
   *  direct_question (there's no system to restate). */
  restated_understanding: z.string().optional(),
  subqueries: z.array(SubqueneSchema).min(1),
});

export type QueryUnderstanding = z.infer<typeof UnderstandingSchema>;

const TOOL_NAME = "emit_understanding";

const TOOL: LlmTool = {
  name: TOOL_NAME,
  description:
    "Emit the structured understanding of the user's input: its type, whether a " +
    "system description is sufficient to map reliably, and retrieval sub-queries.",
  input_schema: {
    type: "object",
    properties: {
      input_type: {
        type: "string",
        enum: ["system_description", "direct_question"],
        description:
          "system_description: describes an AI system/feature being built. " +
          "direct_question: asks a standalone question about a framework/obligation.",
      },
      sufficient: {
        type: "boolean",
        description:
          "For a system_description: true only if the text gives enough signal on " +
          "(1) what the system does, (2) what data it uses, (3) whether it makes or " +
          "informs decisions about people, and (4) where it is deployed/whose data. " +
          "Always true for a direct_question.",
      },
      missing_attribute: {
        type: "string",
        description:
          "Which of the four attributes above is missing and would materially change " +
          "the obligations. Omit if sufficient is true.",
      },
      clarifying_question: {
        type: "string",
        description:
          "Exactly ONE targeted, conversational question to ask the user to fill the " +
          "missing attribute. Omit if sufficient is true.",
      },
      restated_understanding: {
        type: "string",
        description:
          "For a system_description only: one plain sentence restating what the system " +
          "is, e.g. 'An ML-based credit-scoring feature using personal financial data, " +
          "making automated decisions about individuals, deployed to EU users.' Omit for " +
          "a direct_question.",
      },
      subqueries: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            dimension: { type: "string", enum: DIMENSIONS },
            query: {
              type: "string",
              description: "A paraphrase/expansion of the input to maximize retrieval recall.",
            },
          },
          required: ["dimension", "query"],
        },
      },
    },
    required: ["input_type", "sufficient", "subqueries"],
  },
};

const SYSTEM_PROMPT = `You are the query-understanding stage of a governance-obligation research
assistant. You do not answer governance questions yourself — you only classify the
input and produce retrieval sub-queries. Call the ${TOOL_NAME} tool exactly once.

Classify input_type:
- "system_description": describes an AI system/feature being built (e.g. "we score
  loan applicants with an ML model...").
- "direct_question": a standalone question, including questions that name a specific
  framework/article.

Sufficiency (system_description only): a description is sufficient only if it gives
enough signal on what the system does, what data it uses, whether it makes or informs
decisions about people, and where it is deployed / whose data. If a critical attribute
is missing AND its absence would materially change the obligations, set sufficient:false,
name the missing_attribute, and phrase exactly one clarifying_question — conversational,
not a form. Never silently assume. direct_question inputs are always sufficient:true.

Subqueries: produce 2-6 paraphrases/expansions of the input that maximize retrieval
recall against a legal/framework corpus (use precise legal terminology alongside the
plain-language original). Tag each with the single most relevant dimension from:
privacy, ai_regulation, ai_risk, cybersecurity, secure_development. The corpus
currently only covers GDPR (privacy) in full — most subqueries will naturally be
"privacy" during this phase; that's expected.`;

export async function understand(input: string): Promise<QueryUnderstanding> {
  const result = await llm({
    model: MODELS.classify,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: input }],
    maxTokens: 1024,
    tools: [TOOL],
    toolChoice: { type: "tool", name: TOOL_NAME },
  });

  const call = result.toolUses.find((t) => t.name === TOOL_NAME);
  if (!call) {
    throw new Error(`understand(): model did not call ${TOOL_NAME} (stop_reason=${result.stopReason})`);
  }
  return UnderstandingSchema.parse(call.input);
}
