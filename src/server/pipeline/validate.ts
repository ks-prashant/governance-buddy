/**
 * Step B — citation validation, the DR-10 backstop (system design §7.2, build plan §D).
 *
 * For each obligation, check that its `statement` is actually entailed by the text of
 * the chunks it cites — a strict Haiku entailment check, judged ONLY against the cited
 * source (never the model's own knowledge). Obligations whose statement isn't supported
 * are DROPPED. This is what turns "every claim is grounded" from probable into true, and
 * is also the enforcement point for "no parametric knowledge" (DR-11): a statement with
 * no supporting cited text cannot survive, even if Step A produced it.
 *
 * Only the `statement` (the substantive framework claim) is validated, not the
 * `rationale` — the rationale legitimately references the user's own system, which by
 * design isn't in the corpus, and the grading rubric (judge Prompt B) counts only
 * substantive framework claims toward groundedness, ignoring application/framing.
 *
 * Checks run in parallel across obligations. SERVER-ONLY.
 */
import { z } from "zod";
import { llm, type LlmTool } from "./llm";
import { MODELS } from "./config";
import type { Obligation } from "./generate";

const TOOL_NAME = "emit_entailment";

const TOOL: LlmTool = {
  name: TOOL_NAME,
  description: "Emit whether the claim is fully supported by the source text.",
  input_schema: {
    type: "object",
    properties: {
      supported: {
        type: "boolean",
        description:
          "true only if the SOURCE TEXT clearly entails the CLAIM — every substantive part of " +
          "the claim is stated or directly implied by the source. false if any part is not " +
          "supported, or is contradicted, judged ONLY against the source text (not outside knowledge).",
      },
      reason: { type: "string", description: "One sentence explaining the decision." },
    },
    required: ["supported", "reason"],
  },
};

const SYSTEM_PROMPT = `You are a strict entailment checker for a grounded governance assistant. You
are given SOURCE TEXT (verbatim clauses from a governance framework) and a CLAIM the assistant
wants to make. Decide whether the source text fully entails the claim. Judge ONLY against the
source text provided — never use your own knowledge of law or frameworks. If any substantive part
of the claim is not stated or directly implied by the source, it is not supported. Call the
${TOOL_NAME} tool exactly once.`;

const EntailmentSchema = z.object({ supported: z.boolean(), reason: z.string() });

export interface ValidatedObligation extends Obligation {
  validation_reason: string;
}

export interface ValidateResult {
  kept: ValidatedObligation[];
  dropped: Array<{ statement: string; reason: string }>;
}

/** Look up the text of a chunk by id (from the same source set Step A was given). */
export type ChunkTextLookup = Map<string, { citation_label: string; text: string }>;

async function checkOne(
  obligation: Obligation,
  lookup: ChunkTextLookup,
): Promise<{ supported: boolean; reason: string }> {
  const sourceText = obligation.supporting_chunk_ids
    .map((id) => lookup.get(id))
    .filter((c): c is { citation_label: string; text: string } => !!c)
    .map((c) => `(${c.citation_label}) ${c.text}`)
    .join("\n\n");

  if (!sourceText) return { supported: false, reason: "No source text for cited chunk ids." };

  const result = await llm({
    model: MODELS.validate,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `SOURCE TEXT:\n${sourceText}\n\nCLAIM:\n${obligation.statement}`,
      },
    ],
    maxTokens: 512,
    tools: [TOOL],
    toolChoice: { type: "tool", name: TOOL_NAME },
  });

  const call = result.toolUses.find((t) => t.name === TOOL_NAME);
  if (!call) return { supported: false, reason: "Validator did not return a decision." };
  const parsed = EntailmentSchema.safeParse(call.input);
  if (!parsed.success) return { supported: false, reason: "Validator returned malformed output." };
  return parsed.data;
}

export async function validateObligations(
  obligations: Obligation[],
  lookup: ChunkTextLookup,
): Promise<ValidateResult> {
  const checks = await Promise.all(obligations.map((o) => checkOne(o, lookup)));

  const kept: ValidatedObligation[] = [];
  const dropped: Array<{ statement: string; reason: string }> = [];
  obligations.forEach((o, i) => {
    const { supported, reason } = checks[i];
    if (supported) kept.push({ ...o, validation_reason: reason });
    else dropped.push({ statement: o.statement, reason });
  });

  return { kept, dropped };
}
