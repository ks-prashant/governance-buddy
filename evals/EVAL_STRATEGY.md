# Grounded Governance — Evaluation Strategy

**Owner:** Product / Eval · **Companion files:** `golden_set.jsonl`, `judge_prompts.md`, `README.md`, `golden_set_readable.md`
**Corpus snapshot assumed:** GDPR (Reg. (EU) 2016/679), EU AI Act (Reg. (EU) 2024/1689), NIST AI RMF 1.0 (AI 100-1), NIST CSF 2.0 (CSWP 29), NIST SSDF (SP 800-218).

---

## 1. What we are actually testing

The PRD (§1, §3, §7) is explicit that this product's value is **not breadth but trustworthiness**. So the eval is not "does it retrieve relevant text." The eval exists to answer four questions, in priority order:

1. **Is it grounded?** Every substantive claim traces to cited corpus text (PRD §3.3, §8.3, §10.4).
2. **Does it refuse correctly?** Out-of-corpus questions get a refusal card, not a fabricated answer (PRD §6.2, §8.4).
3. **Are citations right?** A citation points at the clause that actually supports the claim (PRD §3.3, §11.2).
4. **Does it reason across frameworks without inventing a verdict?** Cross-framework synthesis and conflict surfacing are the differentiator (PRD §6.1 step 6, §7, §9).

Everything below serves those four questions. A build that is fluent, fast, and well-designed but ungrounded is a **failing** build. That inversion of the usual priority is the whole point of this product, so it is the whole point of the eval.

## 2. Design principles for the question set

1. **Weight toward failure modes, not coverage.** Per PRD §11.1 the set is deliberately skewed to hard cases. A set that the product passes easily tells us nothing. Roughly two-thirds of the questions are engineered to *induce* the specific failures the PRD is most afraid of: confident-but-wrong synthesis, answering out-of-corpus, thin-input over-commitment, and false conflict resolution.
2. **Every expected answer is human-verifiable against a real clause.** Each question carries the exact framework + article/section anchor and the fact the clause supports. No expected answer rests on outside knowledge. This is what makes the set a *golden* set rather than a vibe check. (Anchors were pulled directly from the five source documents — see `golden_set_readable.md` for the human-readable map.)
3. **The "right answer" is often a behavior, not a fact.** For out-of-corpus and thin-input questions, the correct output is a refusal or a clarifying question. The grader scores the *behavior*, so these questions carry `expected_behavior: refuse | clarify` rather than an answer.
4. **Trap fields are first-class.** Most questions carry `must_not_include` — specific facts, frameworks, or verdicts that a plausible-but-wrong answer would contain. Grounded systems avoid these; hallucinating ones walk into them. This is how we catch subtle wrongness that a "did it mention Article 22?" check would miss.
5. **Realistic user voice.** Questions are phrased the way the PRD's primary user talks (PRD §2.1) — a PM/engineer who was "told to make it compliant," not a lawyer. System-description inputs read like the PRD's own examples (loan scoring, résumé ranking, customer-record summarization).

## 3. Question categories and target mix

Target **64 questions** (inside the PRD's 50–100 band, §11.1), distributed to over-sample hard cases:

| Category | Count | What it proves | Maps to PRD |
|---|---|---|---|
| **Cross-framework synthesis** | 18 | Reasons across ≥2 frameworks; the core differentiator | §6.1 step 6, §10.2 |
| **Out-of-corpus (refusal)** | 12 | Refuses instead of fabricating | §6.2, §8.4, §11.2 |
| **Adversarial** | 12 | Resists pressure to give a confident, unsupported answer | §7, §11.1 |
| **Direct-lookup (baseline)** | 12 | Single-source retrieval works at all | §8.1, §11.1 |
| **Sufficiency / clarification** | 6 | Asks one question on thin input instead of guessing | §6.1 step 2, §8.2 |
| **Conflict surfacing** | 4 | Shows framework tension without resolving it | §6.1 step 6, §9 |

The count is deliberately modest and high-quality rather than padded to 100. It is trivial to expand later (see §8); it is not trivial to make each item verifiable, and verifiability is the asset.

## 4. Metrics, definitions, and gates

Four metrics, taken straight from PRD §3.3 / §11.2, plus two diagnostics. "Gating" metrics fail the build if they regress below target (PRD §11.3).

| Metric | Definition (unit of measurement) | Target | Gate? |
|---|---|---|---|
| **Groundedness** | Of all *substantive claims* emitted across the answered questions, the share supported by the cited/retrieved context | ≥ 95% | **Yes** |
| **Citation accuracy** | Of all *citations* emitted, the share that point to a clause actually supporting the adjacent claim | ≥ 90% | **Yes** |
| **Correct-refusal rate** | Of the *out-of-corpus* questions, the share correctly declined (refusal card, no fabricated substance) | ≥ 90% | **Yes** |
| **Retrieval hit rate** | Of questions with a known supporting clause, the share where that clause appears in top-k retrieval | Track & report | No (diagnostic) |
| **Clarification precision** | Of *thin-input* questions, the share that correctly ask exactly one clarifying question (and, inversely, sufficient inputs that are *not* interrogated) | Track & report | No (diagnostic) |
| **Answer correctness** | Of answered factual questions, share whose `must_include` facts are all present and `must_not_include` traps all absent | Track & report | No (diagnostic, but watch) |

Two failure types matter asymmetrically and are reported separately:
- **False answer on out-of-corpus** (answered when it should have refused) — the most dangerous failure; a single one is worth investigating even if the rate passes.
- **Over-refusal / over-clarification** (refused or interrogated when it should have answered) — erodes usefulness; tracked so we don't "pass" groundedness by refusing everything.

## 5. How each question is graded

Grading is a hybrid: deterministic checks where possible, LLM-as-judge where semantic judgment is needed, human spot-check on a sample. Full judge prompts are in `judge_prompts.md`.

**Per-question pipeline:**
1. **Behavior gate (deterministic).** Compare the product's action (answered / refused / asked-one-clarifying-question) against `expected_behavior`. A mismatch is scored as a behavior failure regardless of content. This alone decides every refusal and clarification question.
2. **Claim extraction + groundedness (judge).** For answered questions, the judge decomposes the answer into substantive claims and, for each, checks whether the *supplied retrieved context* supports it. Groundedness = supported claims / total claims.
3. **Citation accuracy (judge + deterministic).** Each emitted citation is checked two ways: (a) does the cited anchor exist in the corpus, and (b) does the text at that anchor support the claim it is attached to. `expected_citations` gives the judge the ground-truth anchor(s) to compare against.
4. **Trap check (deterministic + judge).** `must_include` facts must all be present; `must_not_include` traps must all be absent. Presence of a trap (e.g., a compliance verdict, an invented article number, a framework not in corpus) is an automatic content failure for that item.
5. **Applicability label check (where relevant).** For obligation-map items, confirm the Direct / Inferred / Possible label is defensible given the strength of the underlying clause (PRD §8.4).

**Why LLM-as-judge is safe here:** the judge is never asked "is this the right answer" from its own knowledge — it is asked "is claim X supported by *this provided text*," which is an entailment task grounded in the same context the product used. The golden anchors and trap lists constrain it further. Use a strong model as judge (e.g. a current Claude model) and, per PRD §11.3, keep the judge model/prompt version pinned so scores are comparable across runs.

## 6. Guarding against the classic eval traps

- **Grader leakage:** the judge sees the retrieved context and the golden anchor, but is instructed to score support, not to "match the golden answer" verbatim — different valid phrasings must pass.
- **Refusing-everything gaming:** over-refusal and over-clarification are measured (§4) so a lazy "refuse always" strategy tanks the answer-correctness and clarification-precision diagnostics even while it inflates refusal rate.
- **Citation theater:** a citation that exists but doesn't support the claim fails citation accuracy; a claim with no citation fails groundedness. Both are needed, so decorative citations don't help.
- **Snapshot drift:** every expected answer is tied to the labeled corpus snapshot (PRD §5, §7). When a framework version changes, the affected questions are re-verified before the numbers are trusted — the corpus date is part of the run record.

## 7. Run cadence and the in-product report

- The harness runs as a repeatable job (PRD §11.3, §12) — locally, and in CI on every change to retrieval/generation/prompt/corpus.
- Each run writes a `results.json` and a `report.md`; the latest results populate the in-product **Evaluation report** page (PRD §8.8): each metric with its target, latest value, and run date, plus representative example questions drawn from `golden_set.jsonl`.
- **Gate:** a build that drops below target on groundedness, citation accuracy, or correct-refusal is marked failing and does not ship (PRD §11.3). Diagnostics don't gate but a large move triggers review.

## 8. Extending the set later

The set is designed to grow without losing its properties:
- Keep the category mix skewed to hard cases; add new items with the same required fields (`expected_behavior`, `expected_citations`, `must_include`, `must_not_include`).
- Add questions for any framework version bump, and for any real user session that produced a wrong/ungrounded answer (regression capture) — turning production misses into permanent golden items is the highest-value expansion.
- If you add a framework or jurisdiction (PRD §4.2 / §16 Phase 3), add both in-corpus questions for it *and* new out-of-corpus questions just outside its new boundary, so the refusal edge moves with the corpus.
