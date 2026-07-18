/**
 * Query understanding — one cheap Haiku call doing classification + sufficiency +
 * decomposition together (system design §6.1, build plan §C step 1).
 *
 * Returns whether the input is a system description or a direct question, whether
 * a system description supplies enough to map reliably (PRD §8.2 — function, data,
 * decision-impact-on-people, deployment region), and a set of retrieval sub-queries.
 *
 * Phase E: the real DR-4 five-dimension fan-out is ON — a system_description is
 * decomposed into sub-queries spanning privacy (GDPR), ai_regulation (EU AI Act),
 * ai_risk (NIST AI RMF), cybersecurity (NIST CSF 2.0), and secure_development (NIST
 * SSDF), so cross-framework coverage is produced by design, not by luck. A direct
 * question is expanded/rewritten for recall (DR-5) instead of fanned out.
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
          "where it is deployed/whose data — but ONLY when the ask itself is BROAD (a full " +
          "obligation map / general compliance check, e.g. 'is our app compliant?', 'what " +
          "are our obligations?'). A bare 'is our app compliant?' with zero system detail " +
          "is missing all four and must be sufficient:false. Always true for a " +
          "direct_question. EXCEPTION — NARROW asks are always sufficient:true regardless " +
          "of unstated system attributes, because more detail would not change whether THAT " +
          "specific thing is answerable (only corpus coverage does, checked downstream): " +
          "(a) the input names a specific external law/regulation/standard as its subject " +
          "(HIPAA, CCPA, a named state/city law, LGPD, PIPL, UK GDPR, etc.); (b) the input " +
          "names a specific tension, conflict, or comparison between two identifiable things " +
          "('how do these frameworks pull against each other on X vs Y', 'which is it, A or " +
          "B?') even without full system detail — the tension itself is what's being asked " +
          "about, not a full map.",
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
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            dimension: { type: "string", enum: DIMENSIONS },
            query: {
              type: "string",
              description:
                "A retrieval sub-query using the precise terminology of the framework(s) " +
                "that own this dimension (privacy→GDPR, ai_regulation→EU AI Act, ai_risk→" +
                "NIST AI RMF, cybersecurity→NIST CSF 2.0, secure_development→NIST SSDF), so " +
                "the query semantically matches that corpus, not just the plain-language input.",
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

Sufficiency — the central question is BROAD vs. NARROW, not "how much system detail is
present":
- A BROAD ask requests a full obligation map or general compliance read on the user's own
  system ("is our app compliant?", "what are our obligations?", "map this for us", or a
  system_description offered with no specific question attached). For these, sufficient
  only if the input gives enough signal on what the system does, what data it uses,
  whether it makes or informs decisions about people, and where it is deployed / whose
  data. If a critical attribute is missing AND its absence would materially change the
  obligations, set sufficient:false, name the missing_attribute, and phrase EXACTLY ONE
  clarifying_question. A bare "is our app compliant?" with zero system detail is missing
  ALL four attributes — still ask only ONE question, naming the most critical gap (what
  the system does), not a list of everything missing. Never silently assume.
- A NARROW ask names a specific, self-contained thing to resolve — a named external
  framework, a named clause, or a specific tension/conflict/comparison between two
  identifiable requirements ("how do these frameworks pull against each other on X vs
  Y?", "which is it, A or B?", "do these goals conflict?"). These are ALWAYS
  sufficient:true, even when phrased with "our AI"/"our system" and even when other
  system attributes (decision impact, deployment region, etc.) are unstated — because
  more detail about the system would not change whether THAT SPECIFIC thing is
  answerable. Whether it's actually answerable is a corpus-coverage question, decided by
  retrieval downstream, not by this classification step. Two common shapes of narrow ask:
  (a) names a specific external law/regulation/standard as its subject (HIPAA, CCPA, a
  named state/city law, LGPD, PIPL, UK GDPR, ISO certifications, etc.); (b) names a
  specific documented tension between two things the user already knows (e.g. "we need
  ethnicity data to test for bias, but privacy rules push us to collect less — how do
  these frameworks pull here?" already tells you the tension is bias-testing-data vs.
  minimisation; asking what the system decides or where it's deployed doesn't change
  whether that tension is answerable).
- "direct_question" inputs are always sufficient:true, independent of the above.

Only ask a clarifying question when the ask is genuinely BROAD and thin — never for a
narrow, specific ask just because it happens to omit some system attributes.

The clarifying_question MUST be a single question — one sentence, one "?", asking about
ONE thing (the single most critical missing attribute). Do NOT bundle multiple asks
("what does it do, what data, and where is it deployed?") into one sentence — that
counts as multiple questions even inside one sentence. If several attributes are
missing, pick only the one that would most change the obligations and ask about that
alone; the user can be asked again next turn if more is still missing.

Subqueries — the corpus covers FIVE frameworks, one per governance dimension:
  privacy → GDPR · ai_regulation → EU AI Act · ai_risk → NIST AI RMF ·
  cybersecurity → NIST CSF 2.0 · secure_development → NIST SSDF.

For a "system_description": FAN OUT across every dimension that plausibly applies to the
system — one sub-query per relevant dimension (usually 4–6 of the five), each phrased in
that framework's own terminology so it matches that corpus (e.g. privacy: "lawful basis,
data minimisation, automated decision-making, DPIA"; ai_regulation: "high-risk AI system,
conformity assessment, human oversight, technical documentation"; ai_risk: "MAP/MEASURE/
MANAGE, trustworthiness characteristics, bias"; cybersecurity: "PROTECT/DETECT, access
control, data security, logging"; secure_development: "secure SDLC, vulnerability response,
third-party components"). This is what makes cross-framework coverage happen BY DESIGN
(DR-4) rather than by luck — do not collapse everything into one "privacy" query. Only skip
a dimension if the system clearly has no connection to it at all.

For a "direct_question": expand/rewrite the question for recall (DR-5) — 2–4 sub-queries
with precise legal/framework terminology alongside the plain-language original. Tag each
with its most relevant dimension; a framework-specific question may legitimately stay within
one or two dimensions. Do not fabricate cross-framework fan-out for a question that is plainly
about a single framework.`;

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
