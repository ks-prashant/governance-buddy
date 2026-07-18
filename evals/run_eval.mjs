#!/usr/bin/env node
// Grounded Governance — reference eval harness.
// Dependency-free (Node >=18 built-ins only). Runs the golden set through the product,
// grades with an LLM judge per judge_prompts.md, writes results.json + report.md,
// and exits non-zero if a gating metric is below target (PRD §11.3).
//
// Adapters are wired (callProduct -> the deployed /api/generate; callJudge -> Anthropic
// directly). Needs ANTHROPIC_API_KEY in the environment (the judge runs here, in the
// harness — separate from whatever key the deployed product itself uses). Run:
//   bun evals/run_eval.mjs evals/golden_set.jsonl
//   SUBSET_IDS="DL-01,DL-02" bun evals/run_eval.mjs evals/golden_set.jsonl   # a subset
//
// The grading logic mirrors judge_prompts.md. If you change the prompts there, change
// the JUDGE_* prompt builders below to match, and bump JUDGE_PROMPT_VERSION.

import { readFileSync, writeFileSync } from "node:fs";

const JUDGE_PROMPT_VERSION = "1.0.0";
const TARGETS = { groundedness: 0.95, citationAccuracy: 0.90, correctRefusal: 0.90 };

// Config (bun auto-loads .env / .env.local):
//   PRODUCT_URL       deployed app base URL (default: the published Cloudflare Worker)
//   ANTHROPIC_API_KEY needed by the judge (the judge runs here, in the harness)
//   JUDGE_MODEL       pinned judge model id
//   SUBSET_IDS        optional comma-separated golden ids to run (e.g. the GDPR-only
//                     subset in Phase D; omit to run the whole set)
const PRODUCT_URL = process.env.PRODUCT_URL || "https://pact-wise-guide.lovable.app";
const JUDGE_MODEL = process.env.JUDGE_MODEL || "claude-sonnet-5";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ---------------------------------------------------------------------------
// ADAPTERS — wired to the deployed product endpoint and the judge model.
// ---------------------------------------------------------------------------

// Send one user input to the product's grounded-generation endpoint (non-streaming
// mode) and return {text, citations, retrievedContext} for grading.
async function callProduct(input, _inputType) {
  const res = await fetch(`${PRODUCT_URL}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, stream: false }),
  });
  if (!res.ok) throw new Error(`product ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return {
    text: data.text || "",
    citations: data.citations || [],
    retrievedContext: data.retrievedContext || "",
    behavior: data.behavior,
  };
}

// Send a judge prompt to the pinned judge model. Returns raw text (expected strict JSON).
async function callJudge(prompt) {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set (the judge needs it).");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      max_tokens: 6000, // Prompt B's per-claim/per-citation breakdown can legitimately
      // exceed 2000 tokens for a thorough answer with many citations — a truncated
      // judge response risks parsing a partial claim as a false "contradicted"/miss.
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`judge ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
}

// ---------------------------------------------------------------------------
// Judge prompt builders (mirror judge_prompts.md).
// ---------------------------------------------------------------------------

const promptA = (item, response) => `You are grading an AI governance assistant. Classify the ACTUAL behavior into exactly one of: answer, refuse, clarify, error.
EXPECTED behavior: ${item.expected_behavior}
USER INPUT: ${item.input}
PRODUCT RESPONSE: ${response.text}
Also judge clarify_count (integer) and contains_verdict (true if it states/implies a compliance verdict like "you are compliant/not compliant", "this is legal/illegal", "yes you're fine").
Return strict JSON only: {"behavior":"answer|refuse|clarify|error","matches_expected":true|false,"clarify_count":N,"contains_verdict":true|false,"reason":"one sentence"}`;

const promptB = (item, response) => `You are auditing GROUNDEDNESS and CITATION ACCURACY. Judge ONLY against the retrieved context; do not use outside legal knowledge.
RETRIEVED CONTEXT:
${response.retrievedContext || "(none provided)"}
ASSISTANT ANSWER (with citations):
${response.text}
GROUND-TRUTH ANCHORS: ${JSON.stringify(item.expected_citations)}
Step 1: break the answer into substantive claims (what a framework requires/prohibits/classifies). Step 2: mark each supported|unsupported|contradicted vs the context. Step 3: for each citation the assistant emitted, judge exists_in_context and supports_claim.
Return strict JSON only: {"claims":[{"text":"...","verdict":"supported|unsupported|contradicted"}],"citations":[{"cited":"...","exists_in_context":true|false,"supports_claim":true|false}],"notes":"one sentence"}`;

const promptC = (item, response) => `Check required and forbidden content.
ASSISTANT ANSWER:
${response.text}
MUST_INCLUDE: ${JSON.stringify(item.must_include || [])}
MUST_NOT_INCLUDE: ${JSON.stringify(item.must_not_include || [])}
Return strict JSON only: {"included":[{"item":"...","present":true|false}],"forbidden":[{"item":"...","present":true|false}],"notes":"one sentence"}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJudge(raw) {
  // Tolerate models that wrap JSON in prose or code fences.
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Judge returned no JSON: " + raw.slice(0, 200));
  return JSON.parse(m[0]);
}

function retrievalHit(item, response) {
  if (!item.expected_citations?.length) return null; // not applicable
  const ctx = (response.retrievedContext || "").toLowerCase();
  // Heuristic: an anchor is "hit" if its framework and the core of its anchor string appear.
  return item.expected_citations.some((c) => {
    const anchorCore = String(c.anchor).toLowerCase().replace(/[()]/g, " ");
    const tokens = anchorCore.split(/\s+/).filter((t) => t.length > 1).slice(0, 3);
    return ctx.includes(String(c.framework).toLowerCase()) && tokens.some((t) => ctx.includes(t));
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const file = process.argv[2] || "golden_set.jsonl";
  let items = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));

  const subset = process.env.SUBSET_IDS
    ? new Set(process.env.SUBSET_IDS.split(",").map((s) => s.trim()))
    : null;
  if (subset) items = items.filter((it) => subset.has(it.id));
  console.error(`Running ${items.length} item(s) against ${PRODUCT_URL} · judge=${JUDGE_MODEL}`);

  const results = [];
  for (const item of items) {
    const rec = { id: item.id, category: item.category, expected_behavior: item.expected_behavior, failures: [] };
    let response;
    try {
      response = await callProduct(item.input, item.input_type);
    } catch (e) {
      rec.error = String(e.message || e);
      rec.behavior = "error";
      rec.failures.push("product_error");
      results.push(rec);
      continue;
    }

    // Prompt A — behavior gate (every item)
    const a = parseJudge(await callJudge(promptA(item, response)));
    rec.behavior = a.behavior;
    rec.matches_expected = a.matches_expected;
    rec.contains_verdict = a.contains_verdict;
    rec.clarify_count = a.clarify_count;
    if (!a.matches_expected) rec.failures.push("behavior_mismatch");
    if (a.contains_verdict) rec.failures.push("verdict_leak");
    if (item.expected_behavior === "clarify" && a.clarify_count !== 1) rec.failures.push("not_exactly_one_clarify");

    rec.retrieval_hit = retrievalHit(item, response);

    // Refusal / clarification items are fully scored by Prompt A.
    if (item.expected_behavior !== "answer") { results.push(rec); continue; }

    // Prompt B — groundedness & citations
    const b = parseJudge(await callJudge(promptB(item, response)));
    const claims = b.claims || [];
    rec.claims_total = claims.length;
    rec.claims_supported = claims.filter((c) => c.verdict === "supported").length;
    rec.claims_contradicted = claims.filter((c) => c.verdict === "contradicted").length;
    const cites = b.citations || [];
    rec.citations_total = cites.length;
    rec.citations_valid = cites.filter((c) => c.exists_in_context && c.supports_claim).length;
    if (rec.claims_contradicted > 0) rec.failures.push("contradicted_claim");

    // Prompt C — traps
    const c = parseJudge(await callJudge(promptC(item, response)));
    const missing = (c.included || []).filter((x) => !x.present).map((x) => x.item);
    const traps = (c.forbidden || []).filter((x) => x.present).map((x) => x.item);
    rec.missing_required = missing;
    rec.tripped_traps = traps;
    rec.answer_correct = missing.length === 0 && traps.length === 0;
    if (traps.length) rec.failures.push("trap_tripped");
    if (missing.length) rec.failures.push("missing_required");

    results.push(rec);
  }

  // ----- Aggregate metrics -----
  const answered = results.filter((r) => r.expected_behavior === "answer" && r.claims_total != null);
  const sum = (arr, k) => arr.reduce((n, r) => n + (r[k] || 0), 0);

  const groundedness = sum(answered, "claims_supported") / Math.max(1, sum(answered, "claims_total"));
  const citationAccuracy = sum(answered, "citations_valid") / Math.max(1, sum(answered, "citations_total"));

  const ooc = results.filter((r) => r.category === "out_of_corpus");
  const correctRefusal = ooc.filter((r) => r.behavior === "refuse" && r.matches_expected).length / Math.max(1, ooc.length);

  const withAnchors = results.filter((r) => r.retrieval_hit !== null);
  const retrievalHitRate = withAnchors.filter((r) => r.retrieval_hit).length / Math.max(1, withAnchors.length);

  const clarItems = results.filter((r) => ["clarification"].includes(r.category));
  const clarificationPrecision = clarItems.filter((r) => r.matches_expected && (r.expected_behavior !== "clarify" || r.clarify_count === 1)).length / Math.max(1, clarItems.length);

  const answerCorrectness = answered.filter((r) => r.answer_correct).length / Math.max(1, answered.length);
  const verdictLeaks = results.filter((r) => r.contains_verdict).length;
  const falseAnswersOnOOC = ooc.filter((r) => r.behavior === "answer").length;

  const metrics = {
    run_date: new Date().toISOString().slice(0, 10),
    judge_prompt_version: JUDGE_PROMPT_VERSION,
    groundedness, citationAccuracy, correctRefusal,
    retrievalHitRate, clarificationPrecision, answerCorrectness,
    verdictLeaks, falseAnswersOnOOC,
    counts: { total: results.length, answered: answered.length, outOfCorpus: ooc.length },
  };

  writeFileSync("results.json", JSON.stringify({ metrics, results }, null, 2));

  const pct = (x) => (x * 100).toFixed(1) + "%";
  const gate = (v, t) => (v >= t ? "PASS" : "**FAIL**");
  const report = `# Evaluation Report — ${metrics.run_date}

Judge prompt version: ${JUDGE_PROMPT_VERSION} · Items: ${results.length}

| Metric | Target | Latest | Gate |
|---|---|---|---|
| Groundedness | ≥ 95% | ${pct(groundedness)} | ${gate(groundedness, TARGETS.groundedness)} |
| Citation accuracy | ≥ 90% | ${pct(citationAccuracy)} | ${gate(citationAccuracy, TARGETS.citationAccuracy)} |
| Correct-refusal rate | ≥ 90% | ${pct(correctRefusal)} | ${gate(correctRefusal, TARGETS.correctRefusal)} |
| Retrieval hit rate | report | ${pct(retrievalHitRate)} | — |
| Clarification precision | report | ${pct(clarificationPrecision)} | — |
| Answer correctness | report | ${pct(answerCorrectness)} | — |
| Verdict leaks | 0 | ${verdictLeaks} | ${verdictLeaks === 0 ? "PASS" : "**WATCH**"} |
| False answers on out-of-corpus | 0 | ${falseAnswersOnOOC} | ${falseAnswersOnOOC === 0 ? "PASS" : "**WATCH**"} |

## Failing items
${results.filter((r) => r.failures.length).map((r) => `- ${r.id} (${r.category}): ${r.failures.join(", ")}`).join("\n") || "None."}
`;
  writeFileSync("report.md", report);

  const failedGate =
    groundedness < TARGETS.groundedness ||
    citationAccuracy < TARGETS.citationAccuracy ||
    correctRefusal < TARGETS.correctRefusal;

  console.log(report);
  if (failedGate) { console.error("\nGATING METRIC BELOW TARGET — build is failing (PRD §11.3)."); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
