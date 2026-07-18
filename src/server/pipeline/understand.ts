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
          "system_description: describes an AI system/feature being built, INCLUDING a " +
          "bare compliance question about the user's own unnamed system (e.g. 'is our app " +
          "compliant?') — these presuppose a system but describe none of its attributes. " +
          "direct_question: a standalone question about a framework/article/topic that does " +
          "NOT presuppose an undescribed system of the user's own (e.g. 'what does GDPR " +
          "Article 22 say?'). IMPORTANT: if the question NAMES a specific law, regulation, " +
          "or standard (e.g. 'HIPAA', 'the CCPA', \"New York City's bias-audit law\", 'LGPD', " +
          "'UK GDPR') as its subject, classify it direct_question EVEN IF it also uses " +
          "possessive framing like 'our AI' or 'our system' — more system detail would not " +
          "change whether that named regime is answerable; only corpus coverage does, which " +
          "is checked downstream, not here.",
      },
      sufficient: {
        type: "boolean",
        description:
          "For a system_description (including the bare-compliance-question case above): " +
          "true only if the text gives enough signal on (1) what the system does, (2) what " +
          "data it uses, (3) whether it makes or informs decisions about people, and (4) " +
          "where it is deployed/whose data. A bare 'is our app compliant?' with zero system " +
          "detail is missing all four and must be sufficient:false. Always true for a " +
          "direct_question. EXCEPTION: if the input names a specific external law/" +
          "regulation/standard as its subject (HIPAA, CCPA, a named state/city law, LGPD, " +
          "PIPL, UK GDPR, etc.), sufficient must be true regardless of missing system " +
          "attributes — more system detail cannot make an unlisted regime answerable, only " +
          "corpus coverage can, which is checked downstream.",
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
  loan applicants with an ML model...") — INCLUDING a bare compliance question about
  the user's own unnamed system (e.g. "is our app compliant?", "are we GDPR compliant?",
  "does this violate GDPR?"). These presuppose a system but describe none of its
  attributes, so they must go through the same sufficiency check as a thin description —
  do NOT classify them as "direct_question" just because they're phrased as a question.
- "direct_question": a standalone question about a framework, article, or general
  governance topic that does NOT presuppose an undescribed system of the user's own —
  e.g. "what does GDPR Article 22 say?", "what are the lawful bases for processing under
  GDPR?". These can be answered without knowing anything about "our system". This
  includes questions that NAME a specific external law/regulation/standard as their
  subject (e.g. "does HIPAA apply to our AI's use of patient data?", "how does UK GDPR
  differ from EU GDPR for our system?") — classify these direct_question EVEN THOUGH they
  use "our AI"/"our system" phrasing. The test is whether MORE SYSTEM DETAIL would change
  the answer: for a named external regime, it would not — either that regime is in the
  corpus and answerable, or it isn't and the honest answer is "not in the current corpus,"
  which retrieval determines, not more description. Reserve the sufficiency/clarify path
  for inputs that do NOT name a specific external framework (a generic "is our app
  compliant?" or a thin feature description with no named law at all).

Sufficiency: for "system_description" (including the bare-compliance-question case
above), sufficient only if the input gives enough signal on what the system does, what
data it uses, whether it makes or informs decisions about people, and where it is
deployed / whose data. If a critical attribute is missing AND its absence would
materially change the obligations, set sufficient:false, name the missing_attribute,
and phrase EXACTLY ONE clarifying_question. A bare "is our app compliant?" with zero
system detail is missing ALL four attributes — still ask only ONE question, naming the
most critical gap (what the system does), not a list of everything missing. Never
silently assume. "direct_question" inputs are always sufficient:true.

EXCEPTION — named external regime overrides sufficiency: if the input names a specific
external law/regulation/standard as its subject (HIPAA, CCPA, a named state/city law,
LGPD, PIPL, UK GDPR, ISO certifications, etc.), set sufficient:true and skip
clarifying_question EVEN IF you classified input_type as "system_description" and even
if some system attributes are still unstated. More system detail cannot make an
unlisted regime answerable — only corpus coverage can, and that is determined by
retrieval downstream, not by this classification step. Only ask a clarifying question
about system attributes when NO specific external framework is named at all.

The clarifying_question MUST be a single question — one sentence, one "?", asking about
ONE thing (the single most critical missing attribute). Do NOT bundle multiple asks
("what does it do, what data, and where is it deployed?") into one sentence — that
counts as multiple questions even inside one sentence. If several attributes are
missing, pick only the one that would most change the obligations and ask about that
alone; the user can be asked again next turn if more is still missing.

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
