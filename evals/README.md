# Grounded Governance — Evaluation Harness

Everything you need to run evals against the product, now or once it's built. This folder is self-contained and version-controllable.

```
evals/
├── EVAL_STRATEGY.md      Why the eval is shaped this way; metrics, gates, principles
├── golden_set.jsonl      64 golden questions with expected answers, citations, and traps
├── golden_set_readable.md Human-readable companion (browse/verify the set by eye)
├── judge_prompts.md      LLM-as-judge grading prompts (behavior, groundedness, citations, traps)
├── run_eval.mjs          Reference harness (Node) — wire callProduct() + callJudge() to your stack
└── README.md             This file
```

Read `EVAL_STRATEGY.md` first — it explains what is being tested and why the question mix is skewed to hard cases.

---

## The golden set schema

Each line of `golden_set.jsonl` is one question:

| Field | Meaning |
|---|---|
| `id` | Stable id (`CF/OOC/ADV/DL/CLR/CONF-NN`). Never renumber — results are tracked by id. |
| `category` | `cross_framework` \| `out_of_corpus` \| `adversarial` \| `direct_lookup` \| `clarification` \| `conflict` |
| `input_type` | `system_description` (→ obligation map) or `direct_question` (→ grounded answer) |
| `difficulty` | `easy` \| `medium` \| `hard` |
| `input` | The exact user text to send to the product |
| `expected_behavior` | `answer` \| `refuse` \| `clarify` — the correct top-level behavior |
| `expected_frameworks` | Which of the five frameworks a correct answer draws on (empty for refusals) |
| `expected_citations` | Ground-truth anchors `{framework, anchor, supports}` — what a correct answer should cite |
| `must_include` | Facts/behaviors that must be present (checked in substance, not verbatim) |
| `must_not_include` | Traps that must be absent (out-of-corpus frameworks, invented articles, verdicts) |
| `expected_applicability` | (optional) expected Direct/Inferred/Possible labels for map items |
| `notes` | Grader guidance: why the item is hard / what the trap is |

The anchors were extracted directly from the five source PDFs. `golden_set_readable.md` lists every anchor so you can spot-check them against the documents.

---

## Metrics (from PRD §3.3 / §11.2)

| Metric | How it's computed | Target | Gates the build? |
|---|---|---|---|
| **Groundedness** | supported claims ÷ total substantive claims (Judge Prompt B) | ≥ 95% | **Yes** |
| **Citation accuracy** | valid+supporting citations ÷ total citations (Judge Prompt B) | ≥ 90% | **Yes** |
| **Correct-refusal rate** | correctly-refused ÷ out-of-corpus items (Judge Prompt A) | ≥ 90% | **Yes** |
| **Retrieval hit rate** | items whose expected anchor was in top-k ÷ items with anchors | report | no |
| **Clarification precision** | correct clarify/answer decisions on thin-vs-sufficient inputs | report | no |
| **Answer correctness** | items passing all must_include/must_not_include (Judge Prompt C) | report | no |
| **Verdict leaks** | count of answers containing a compliance verdict (should be 0) | report | watch |
| **False answers on out-of-corpus** | out-of-corpus items that were answered (should be 0) | report | watch |

A build below target on any of the three gating metrics is **failing** and does not ship (PRD §11.3).

---

## Running it in Claude Code

The harness is intentionally small so Claude Code can adapt it to whatever the product's real interface turns out to be. Typical flow:

1. **Point Claude Code at this folder** and tell it: *"Run the eval in `evals/` against the product and write `results.json` and `report.md`."*
2. Claude Code opens `run_eval.mjs` and wires the two adapter functions to the actual product:
   - `callProduct(input)` → send the user input to your product's endpoint; return `{ text, citations, retrievedContext }`.
   - `callJudge(prompt)` → send a judge prompt to your judge model; return the model's text.
   (Both are stubbed with `TODO` markers. The product isn't built yet, so these are deliberately left for wiring time.)
3. Run it: `node run_eval.mjs golden_set.jsonl` (once Node is available in the build environment).
4. It iterates the golden set, applies the grading pipeline from `judge_prompts.md`, and writes:
   - `results.json` — per-item verdicts and the aggregate metrics.
   - `report.md` — a human-readable summary: each metric with target, latest value, and run date, plus example questions. This is the artifact that feeds the in-product **Evaluation report** page (PRD §8.8).
5. **Gate check:** if groundedness < 95%, citation accuracy < 90%, or correct-refusal < 90%, the run exits non-zero so CI marks the build failing (PRD §11.3).

You don't have to use `run_eval.mjs` — the durable assets are `golden_set.jsonl` and `judge_prompts.md`. If the product ships in a different language, ask Claude Code to reimplement the same loop against them; the schema and prompts don't change.

### CI

Add the same command to CI on any change to retrieval, generation, prompts, or the corpus (PRD §11.3, §12). Store `results.json` per run so you can chart the metrics over time and catch regressions.

---

## Maintaining the set

- **Never renumber ids.** Add new items with new ids.
- **Regression capture:** when a real (or test) session produces a wrong/ungrounded/verdict answer, add it as a new golden item so it can't silently come back. This is the highest-value way to grow the set.
- **On a corpus version bump** (a framework snapshot changes), re-verify every affected item's `expected_citations` against the new text before trusting the numbers, and note the new snapshot date in the run record (PRD §5, §7).
- **If you add a framework/jurisdiction** (PRD §16 Phase 3), add in-corpus questions for it *and* new `out_of_corpus` questions just outside its new edge, so the refusal boundary moves with the corpus.

Keep the category mix skewed toward hard cases (cross-framework, out-of-corpus, adversarial). A set the product passes easily has stopped doing its job.
