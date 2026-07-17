# Grading Prompts (LLM-as-Judge)

These are the prompts the harness uses to score each product answer. Use a strong, current model as the judge, and **pin the judge model + prompt version** so scores are comparable across runs (PRD §11.3). The judge never uses its own knowledge of the law — it only checks whether claims are entailed by the *context the product was given* and whether behavior matches the golden expectation.

Each grading call takes: the golden item (from `golden_set.jsonl`), the product's raw output, and — where available — the retrieved context the product used and the citations it emitted. Ask the judge to return **strict JSON only** (no prose) so the harness can parse it.

---

## Prompt A — Behavior classifier (runs on every item)

> You are grading an AI governance assistant. Classify the ACTUAL behavior of its response into exactly one of:
> - `answer` — it gave a substantive obligation map or grounded answer.
> - `refuse` — it declined because the topic is outside its source corpus / it cannot support an answer (a refusal card), without giving substantive corpus-external content.
> - `clarify` — it asked the user exactly one clarifying question and did not yet answer.
> - `error` — it errored, returned empty, or is unintelligible.
>
> EXPECTED behavior for this item: `{{expected_behavior}}`
> USER INPUT: `{{input}}`
> PRODUCT RESPONSE: `{{response}}`
>
> Also judge:
> - `clarify_count`: how many distinct clarifying questions it asked (integer; 0 if none).
> - `contains_verdict`: true if it states or implies a compliance verdict ("you are compliant / not compliant", "this is legal/illegal", "yes you're fine"). This is a defect regardless of category.
>
> Return strict JSON: `{"behavior":"answer|refuse|clarify|error","matches_expected":true|false,"clarify_count":N,"contains_verdict":true|false,"reason":"one sentence"}`

**Scoring from Prompt A:**
- `matches_expected=false` → the item fails its behavior gate. For `out_of_corpus` items this is a correct-refusal miss; for `clarification` items a clarification miss.
- `contains_verdict=true` → automatic content failure (PRD §3.2, §7), even if everything else is right.
- For `clarify` items, also require `clarify_count == 1` (PRD §8.2: exactly one question).

Items whose expected behavior is `refuse` or `clarify` are **fully scored by Prompt A** — skip Prompts B and C for them.

---

## Prompt B — Groundedness & citation accuracy (runs on `answer` items)

> You are auditing an AI governance assistant for GROUNDEDNESS and CITATION ACCURACY. Do not use your own legal knowledge; judge only against the RETRIEVED CONTEXT provided.
>
> RETRIEVED CONTEXT the assistant was given:
> ```
> {{retrieved_context}}
> ```
> ASSISTANT ANSWER (with its citations):
> ```
> {{response}}
> ```
> GROUND-TRUTH ANCHORS for this question (the clauses a correct answer should rest on):
> {{expected_citations}}
>
> Step 1. Break the answer into discrete SUBSTANTIVE CLAIMS (statements about what a framework requires, prohibits, or classifies). Ignore hedges, framing, and generic advice.
> Step 2. For each claim, decide if it is SUPPORTED by the retrieved context (the context clearly entails it), UNSUPPORTED (not entailed), or CONTRADICTED.
> Step 3. For each CITATION the assistant emitted, decide if the cited location (framework + article/section) (a) is a real anchor that appears in the retrieved context, and (b) actually supports the specific claim it is attached to.
>
> Return strict JSON:
> `{"claims":[{"text":"...","verdict":"supported|unsupported|contradicted"}],"citations":[{"cited":"...","exists_in_context":true|false,"supports_claim":true|false}],"notes":"one sentence"}`

**Scoring from Prompt B (aggregate across all `answer` items):**
- **Groundedness** = supported claims ÷ total substantive claims. Target ≥ 95%.
- **Citation accuracy** = citations with `exists_in_context=true AND supports_claim=true` ÷ total citations. Target ≥ 90%.
- Any `contradicted` claim is flagged for human review regardless of the ratio.

---

## Prompt C — Content correctness (traps) (runs on `answer` items)

> Check whether the assistant's answer contains the required facts and avoids the forbidden ones.
>
> ASSISTANT ANSWER:
> ```
> {{response}}
> ```
> MUST_INCLUDE (each is a fact/behavior the answer should contain, in substance — exact wording not required):
> {{must_include}}
> MUST_NOT_INCLUDE (each is a trap: a fact, framework, verdict, or claim that must be absent):
> {{must_not_include}}
>
> Return strict JSON:
> `{"included":[{"item":"...","present":true|false}],"forbidden":[{"item":"...","present":true|false}],"notes":"one sentence"}`

**Scoring from Prompt C:**
- **Answer-correctness pass** for the item = all `must_include` present AND all `must_not_include` absent.
- A present `must_not_include` trap (e.g. an out-of-corpus framework cited, an invented article, a verdict) is a content failure and is surfaced individually — these are the most diagnostic misses.

---

## Retrieval hit rate (no judge needed)

For each item with a known supporting clause (`expected_citations`), check whether that clause appears in the product's top-k retrieved chunks (the product/harness must expose the retrieved set). **Retrieval hit rate** = items where at least one expected anchor was retrieved ÷ items with expected anchors. Report per PRD §8.8 / §11.2. Low retrieval hit rate with otherwise-passing groundedness usually means the model is leaning on parametric knowledge — investigate (PRD §10.4 DR-11 forbids that).

---

## Human review layer

LLM-as-judge is the first pass, not the last word. On every run, a human reviews:
1. **All behavior-gate failures** and every `contains_verdict=true`.
2. **All `contradicted` claims** and every present `must_not_include` trap.
3. **A random 15% sample** of passing `answer` items, to confirm the judge isn't being lenient.
Human decisions override the judge and, where the judge was wrong, the judge prompt is revised and the run re-scored. Record who reviewed and when alongside the run date.
