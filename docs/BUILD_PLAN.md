# Grounded Governance — Build Plan

**For the workflow:** minimal scaffold in **Lovable** (Lovable Cloud) → two-way **GitHub** sync → **Claude Code** authors most code and commits → Lovable only pulls changes, holds secrets/keys, and gives a live preview.
**Companions:** `architecture/SYSTEM_DESIGN.md` (the what/why), `evals/` (the quality gate), `design/DESIGN_AND_BRAND_GUIDELINES.md` (the look/voice), the PRD (the spec).

> **How to use this.** §A sets up the workspace and the rules that keep the three-way sync from fighting itself. §B–§J are phases, in de-risking order. Each phase has **Owner · Steps · Files · Secrets · Acceptance gate · Commit point.** Do them in order — later phases assume earlier ones. Hand each phase to Claude Code as a scoped task; don't start a phase until the previous phase's acceptance gate is green.
>
> **Verify-at-build flags.** A few Lovable Cloud / Supabase mechanics (how migrations and edge functions deploy, exact UI labels) evolve; where the exact flow matters I give the robust path (**Supabase CLI**) plus the Lovable path, and mark it **[verify]**. The architecture doesn't depend on which you pick.
>
> **[Confirmed at build — corrects §A.0 below]** Lovable scaffolded **TanStack Start** (not plain React+Vite), and the BFF/orchestration layer is **TanStack Start server routes** (`src/routes/api/*.ts`, `server: { handlers: { POST } }`) plus plain modules in `src/server/pipeline/*.ts` — **not Supabase Edge Functions**. The deploy target is Cloudflare Workers. Wherever the phases below say `_shared/foo.ts` or "edge function", read it as `src/server/pipeline/foo.ts` and "TanStack server route" respectively — the pipeline logic and phase sequencing are unaffected, only the file locations and deploy mechanism differ from what was assumed when this plan was first written. See `architecture/SYSTEM_DESIGN.md` §4.1 for the full reasoning (Workers have no filesystem, which is *why* ingestion §B below runs offline rather than as an in-app endpoint).

---

## A. Workspace setup & the rules of the loop

### A.0 Stack, concretely (how the system design maps onto Lovable Cloud)

| System-design term | On this stack |
|---|---|
| Web app (UI) | ~~React + Vite front end~~ **TanStack Start** (React 19 + Vite + Nitro) front end that Lovable scaffolds |
| Server / BFF / orchestration | ~~Supabase Edge Functions~~ **TanStack Start server routes**, deployed to **Cloudflare Workers** — this is where the pipeline runs and where all keys live |
| Postgres + pgvector | **Lovable Cloud's Supabase** Postgres, `vector` extension enabled |
| Keyword search (BM25) | Postgres full-text search (`tsvector` + GIN) |
| Secrets (Anthropic, Voyage, reranker) | **Lovable Cloud / Supabase secrets** — referenced only inside TanStack server routes, never the client bundle |
| Ingestion pipeline | **Local/sandboxed Node (bun) scripts** against the Supabase project (offline, per snapshot) — required because Cloudflare Workers have no filesystem to read the corpus from at request time |
| Eval harness | `evals/run_eval.mjs`, `callProduct()` → the deployed TanStack server route |

**Do NOT enable auth, saved sessions, or multi-user** — the MVP is single-session by spec (PRD §4.2, §13). Lovable will offer these; decline them.

### A.1 Division of labor — who touches what

| Task class | Owner |
|---|---|
| App scaffold, initial pages, visual/component tweaks, design-system wiring | **Lovable** (chat prompts) |
| Secrets / API keys, enabling Cloud, DB provisioning, preview/deploy | **Lovable** (its UI) + **you** |
| All pipeline logic, edge functions, migrations, ingestion scripts, schema, eval wiring, most components once scaffolded | **Claude Code** (commits to GitHub) |
| Running ingestion, running evals, linking Supabase CLI, promoting snapshots | **You**, driving **Claude Code** |

Rule of thumb: **Lovable owns pixels and secrets; Claude Code owns logic.** When they overlap (a component that both a Lovable prompt and Claude Code might edit), let Claude Code own it after the first scaffold.

### A.2 Sync discipline (the #1 source of pain — read this)

Lovable and Claude Code both write to the **same GitHub branch** (default `main`). To avoid merge conflicts:

1. **Serialize access to `main`.** At any moment, either you're editing in Lovable *or* Claude Code is committing — not both. They're minutes apart, not simultaneous.
2. **Before touching Lovable:** make sure Claude Code has pushed and `main` is clean (`git status`), so Lovable pulls a consistent tree.
3. **After any Lovable edit:** run `git pull` in Claude Code's checkout **before** you resume coding. Lovable commits directly to `main`; your local copy must catch up first.
4. **Optionally use short-lived feature branches** in Claude Code and merge to `main` via PR; but Lovable syncs `main`, so keep branches short and merge often. If Lovable in your plan supports pointing sync at a specific branch **[verify]**, that's an even cleaner separation — but the serialize-and-pull rule works regardless.
5. **Let Claude Code own generated/config files** it needs (migrations, edge functions, ingestion). Don't hand-edit those in Lovable.

### A.3 Setup steps (once)

**Owner: you + Lovable, then Claude Code.**

1. **Create a minimal Lovable project** and **enable Lovable Cloud** (this provisions the Supabase backend). Ask Lovable for the bare shell: a single landing page with one text input — nothing more. Decline auth.
2. **Connect GitHub** (Lovable → GitHub two-way sync). Confirm commits flow both ways with a trivial test edit.
3. **Clone the repo locally** and point **Claude Code** at it. Move the existing assets into the repo so everything lives in one place and is version-controlled:
   - `corpus/` ← the five source PDFs (currently in the project root)
   - `evals/`, `design/`, `architecture/`, and this file — already authored; commit them.
4. **Enable pgvector.** In the Supabase project (via Lovable Cloud), enable the `vector` extension. Claude Code can do this in the first migration (`create extension if not exists vector;`).
5. **Link the Supabase CLI** to the Lovable-provisioned project (get the project ref / DB connection string from Lovable Cloud settings). This gives Claude Code a deterministic path for migrations (`supabase db push`) and function deploys (`supabase functions deploy`). **[verify]** whether Lovable Cloud also auto-applies migrations / auto-deploys functions on sync; if it does, the CLI is your fallback and your local test path.
6. **Set secrets** in Lovable Cloud (never in the repo): `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` (or chosen embedder), reranker key. Add a **local** `.env` (git-ignored) with the same keys + a Supabase **service-role** key for the ingestion scripts Claude Code runs locally.
7. **Establish the seams** (Claude Code writes these first so everything downstream is swappable): a `config` module for model IDs and weights (`MODEL_CLASSIFY`, `MODEL_GENERATE`, `MODEL_VALIDATE`, tier weights `w1,w2,w3`), an `embed(text)` interface, a `rerank(query, docs)` interface, and a single `llm(opts)` wrapper. This is what lets you A/B models and tune against evals without touching pipeline logic.

### A.4 Repo structure (Claude Code establishes)

**[Updated to reflect what was actually built — see the correction note at the top of this doc]**

```
/corpus/                     five source PDFs (input to ingestion)
/ingestion/                  local/sandboxed bun scripts: parse → structure → chunk → embed → load
  parsers/{gdpr,ai-act,ai-rmf,csf,ssdf}.ts   ({gdpr} done; the rest are Phase E)
  types.ts  lib/pdf.ts  load.ts  validate.ts  run.ts
/corpus-build/               committed, reviewable parse output (structured JSON, NO embeddings)
/supabase/
  migrations/                schema as SQL (the §9 data model) — 0001-0004 so far
/src/
  routes/api/                TanStack server routes (SSE where needed) — NOT Supabase Edge Functions
  server/pipeline/           config, llm(), embed(), rerank(), understand, retrieve, (generate/validate/assemble — Phase D)
  (React front end, Lovable-scaffolded, Claude-Code-extended)
/evals/                      already authored — golden set, judge prompts, runner; check_retrieval.mjs added at build
/design/  /architecture/     already authored
```

### A.5 Config baseline (from the system design, confirm at build)

- Models: `MODEL_CLASSIFY=claude-haiku-4-5`, `MODEL_GENERATE=claude-opus-4-8`, `MODEL_VALIDATE=claude-haiku-4-5`, `MODEL_FOLLOWUP=claude-opus-4-8` (Sonnet 5 as a cost lever later). **[Confirmed at build]** all working model IDs.
- Embeddings: **[Confirmed at build]** `voyage-3-large`, 1024 dimensions — vector column is `vector(1024)`.
- Generation: adaptive thinking on, `effort: high`; **prompt-cache** the stable system prefix. **[Note for Phase D]** forced tool-use (the structured-output mechanism actually used, system design §4.5) is incompatible with `thinking` enabled — resolve this combination when building Step A, don't assume both apply simultaneously.
- Never put user text or the snapshot date *inside* the cached prefix (prefix-match invalidation).
- **[Added at build, binding]** every table gets RLS enabled with zero policies (system design §14.1) — this is now part of the config baseline, not an afterthought.

**Commit point A:** repo scaffolded, assets moved, secrets set, pgvector enabled, CLI linked, seams stubbed. Green = a trivial edge function deploys and the front end loads. **[Done]**

---

## B. Phase 1 — Data spine + ingestion for ONE framework (GDPR)

**Goal:** prove clean hierarchy, chunks, and *resolvable citations* on a single framework before scaling. This is the foundation everything cites.
**Owner:** Claude Code (schema + scripts), you (run ingestion, promote snapshot).

**Steps**
1. **Migration — the schema** (system design §9): `frameworks`, `corpus_snapshots`, `framework_versions`, `parents`, `chunks` (with `vector(D)`, `tsvector`, HNSW + GIN indexes), `conflicts`, `eval_results`, `analytics_events`. Apply via `supabase db push`.
2. **GDPR parser** (`ingestion/parsers/gdpr.ts`): deterministic parse of `corpus/GDPR.pdf` into the real hierarchy — Chapter → Article → paragraph → point, plus Recitals. Emit structured JSON to `/corpus-build/gdpr.json` (committed, reviewable — this is the auditable artifact).
3. **Chunk** (`chunk.ts`): parent–child. Child = paragraph/point (embedded/retrieved). Parent = article (context + source-viewer unit). Link by `parent_id`; attach metadata (`framework_id`, `framework_version`, `snapshot_date`, `hierarchy_path`, `citation_label` e.g. `Art. 22(1)`, `source_url`, char offsets).
4. **Embed + load** (`embed.ts`, `load.ts`): embed child chunks via `embed()`, write parents+chunks to Supabase under a new `snapshot_id`. Batch the embeddings.
5. **Validate gate** (`validate.ts`): every child resolves to a parent; every `citation_label` unique/well-formed; a set of **known GDPR anchors from `evals/golden_set.jsonl`** (Art 5, 6, 9, 13/14/15, 22, 32, 33, 35) resolve to the correct text. **A snapshot that fails validation is not promoted.**
6. **Promote:** flip the active snapshot pointer only on a clean validation.

**Files:** `supabase/migrations/0001_schema.sql`, `ingestion/parsers/gdpr.ts`, `chunk.ts`, `embed.ts`, `load.ts`, `validate.ts`, `run.ts`, `corpus-build/gdpr.json`.
**Secrets touched:** Voyage key + Supabase service-role (local `.env`).
**Acceptance gate:** query the DB for `Art. 22(1)` → returns the exact GDPR text with correct hierarchy path and a working source URL/anchor; validation script passes; embeddings present for all GDPR children.
**Commit point B. [Done]** — 99/99 articles, 173/173 recitals, 562 children, 0 duplicate citation labels, 22/22 golden anchors resolve.

---

## C. Phase 2 — Retrieval (GDPR subset)

**Goal:** turn a query into the right GDPR clauses, measured objectively.
**Owner:** Claude Code.

**Steps**
1. **Query understanding** (`_shared/understand.ts`): one Haiku **structured-output** call → `{input_type, sufficient, missing_attribute?, clarifying_question?, subqueries[]}`. (Full five-dimension decomposition lands in Phase 4; for now, expand/rewrite for GDPR recall.)
2. **Hybrid retrieval** (`_shared/retrieve.ts`): dense (pgvector cosine over child embeddings) + keyword (Postgres FTS) per query; fuse with **RRF**. Metadata filter by framework when scoped.
3. **Rerank + parent-expand** (`_shared/rerank.ts`): rerank the merged pool against the original description via `rerank()`; keep top-N; expand survivors to parents with metadata.
4. **Expose a thin retrieval endpoint** (temporary) so the eval harness can measure retrieval in isolation.

**Acceptance gate:** **retrieval-hit-rate** on the GDPR-only slice of `evals/golden_set.jsonl` (use each item's `expected_citations` as ground truth) meets a sensible bar (e.g. ≥0.9 on direct-lookup items). If low, A/B the embedder behind `embed()` and re-measure — don't proceed on weak retrieval.
**Commit point C. [Done]** — 7/7 on the GDPR slice (direct-lookup items DL-01..04 the actual gate, all pass; also 3/3 adversarial items). Two real retrieval bugs found by this eval and fixed: `websearch_to_tsquery` silently AND-ing every word (killed the keyword arm for natural-language questions) and no path for citation-named lookups (system design §6.2). `evals/check_retrieval.mjs` is the reusable script — rerun it against Phase E's expanded corpus.

---

## D. Phase 3 — Grounded generation + validation (GDPR) — THE risk gate

**Goal:** hit the groundedness/citation targets on one framework. If this works on GDPR, the product works; if it doesn't, stop and fix here before adding breadth.
**Owner:** Claude Code.

> **[Scope change, decided at build]** SSE streaming (originally Phase F step 1) is now **part of this phase**, not a later retrofit. Reason: measuring the real, deployed Phase B/C endpoint showed query-understanding + retrieval alone already take 4.2–5.3s — essentially the entire 5s first-tier latency budget — before generation even starts (`architecture/SYSTEM_DESIGN.md` §8.1, §11, §18). Building Step A as a single blocking call and adding streaming afterward would mean rebuilding the response shape and the eval harness's `callProduct()` adapter a second time. Build it streaming from the first commit of this phase.

**Steps**
1. **Step A — obligation map** (`src/server/pipeline/generate.ts`): Opus 4.8, **structured output**, adaptive thinking + `effort: high`, given the reranked parents (each tagged with `chunk_id`). Returns `{restated_understanding, obligations[{statement, rationale, supporting_chunk_ids, applicability, impact, conflicts_with?}], gaps[], overall_confidence}`. **Grounding fence:** `supporting_chunk_ids` must come from the supplied set. **[Resolve at build]** forced tool-use (the mechanism proven in `src/server/pipeline/understand.ts`) is incompatible with extended thinking — `tool_choice` must be `"auto"` when `thinking` is enabled (system design §4.5). Decide here whether Step A: (a) states the JSON schema in the system prompt with an unconstrained tool choice and parses the model's free-form JSON, (b) runs thinking and structure extraction as two calls, or (c) drops thinking for this call. Don't assume the Phase C pattern (forced tool_choice, no thinking) transfers unchanged.
2. **Step B — citation validation** (`src/server/pipeline/validate.ts`): for each obligation, verify statement+rationale are entailed by its cited parents — via the **Citations API** or a strict Haiku entailment check — **in parallel**. Unsupported claims are dropped/flagged (never shown cited). This is the DR-10 backstop that actually delivers ≥95% groundedness.
3. **Assembly** (`src/server/pipeline/assemble.ts`): build citation chips + source-viewer payloads **from chunk metadata** keyed to `supporting_chunk_ids` (never from model text); compute priority tiers via `w1·applicability + w2·impact + w3·retrieval_confidence`; attach "Decision support, not legal advice" + snapshot date.
4. **Streaming endpoint** (`src/routes/api/generate.ts` or similar, TanStack server route, SSE): stream the restated understanding + progressive-loading stage names immediately once query-understanding resolves; stream each obligation card as it clears Step B validation, **Applies** tier first. Instrument stage timing the same way `src/routes/api/retrieve.ts` already does (`timings_ms`) — that instrumentation is what found the two real latency bugs in Phase C and should do the same job here.
5. **Wire the eval harness:** point `evals/run_eval.mjs` `callProduct()` at the deployed streaming endpoint (consume the full stream, assemble the final response for grading); run the **GDPR subset** through the real pipeline (use the Batch API for judge calls).

**Acceptance gate (the big one):** on the GDPR subset — **groundedness ≥95%, citation accuracy ≥90%, correct-refusal ≥90%**, zero verdict leaks, AND the first tier actually streams to a client within the 5s budget end-to-end (not just in theory). If short on the quality metrics, fix retrieval/prompt/validation here, not later. If short on latency, do not defer the fix to Phase F — it belongs here.
**Commit point D.**

---

## E. Phase 4 — Full corpus + cross-framework synthesis + conflicts

**Goal:** scale the proven pipeline to all five frameworks and light up the differentiator.
**Owner:** Claude Code (parsers + wiring), you (ingest each).

**Steps**
1. **Parsers for the other four** through the same interface: EU AI Act (Chapter→Section→Article→¶ + **Annexes** like `Annex III(5)(b)`), NIST AI RMF (functions + subcategories `MAP 1.1` + the 7 characteristics), CSF 2.0 (`PR.DS-01`), SSDF (`PW.4.1`). **Give the SSDF extra care** — its multi-column tables extract messily; LLM-assist the structuring, then **review and freeze** the output (don't trust it live). Commit each `corpus-build/*.json`.
2. **Ingest + validate + promote** a full five-framework snapshot; validate against the full `expected_citations` set across all frameworks.
3. **Five-dimension decomposition:** turn on the real DR-4 fan-out (privacy / AI-reg / AI-risk / cybersecurity / secure-dev) so cross-framework coverage is by design.
4. **Conflicts:** seed the `conflicts` table with the curated tensions (the `evals/` CONF-01..04 pairs) and honor the model's `conflicts_with` flag; assemble paired, cited, **unresolved** conflict cards.
5. **Full eval run** across all 64 golden questions via the harness.

**Acceptance gate:** all three gating metrics green on the **full** golden set; cross-framework items (CF-*) produce multi-framework maps; conflict items (CONF-*) render paired without resolution; out-of-corpus items (OOC-*) refuse.
**Commit point E.**

---

## F. Phase 5 — The hero UI (consumes Phase D's stream)

**Goal:** the trustworthy, streamed experience from the design guidelines.
**Owner:** Lovable (first scaffold of components) → Claude Code (behavior), guided by `design/DESIGN_AND_BRAND_GUIDELINES.md`.

> **[Scope change, decided at build]** SSE streaming itself moved to Phase D (§D) — it's a backend requirement forced by measured latency, not a UI concern, and building it early avoids a second pass on the response shape and eval adapter. This phase is now **purely the front end that consumes an already-streaming backend** — narrower than originally scoped.

**Steps**
1. **Front end** (scaffold in Lovable, wire in Claude Code): the single hero input (two modes, three example prompts); the **restated-understanding** confirm with "Not quite? Refine"; the **obligation-map cards** (statement → why-this-applies → citation chips → Direct/Inferred/Possible label) in three tiers, rendered incrementally as Phase D's SSE stream delivers them; the **source viewer** (exact paragraph highlighted, hierarchy breadcrumb, version, snapshot date, official-source link).
2. **Apply the design system**: the "instrument and the source" split (sans UI / serif source text / mono citations), functional color, no red-for-priority, no percentages. Citations are the primary CTA.

**Acceptance gate:** the credit-scoring example (`evals/` CF-01 / CLR-04) runs end-to-end in the browser: streamed tiers, clickable citations opening the exact source, restatement editable, latency targets met.
**Commit point F.**

---

## G. Phase 6 — Honesty states (first-class, not error states)

**Goal:** refusal, clarification, "no obligations", conflict, low-confidence, corpus indicator — as intentional UI.
**Owner:** Claude Code + Lovable (styling).

**Steps**
1. **Sufficiency/clarify:** thin input → exactly **one** clarifying question, pipeline pauses (CLR-01/02/03/05 behavior).
2. **Refusal card** for out-of-corpus (routed, not generated) — neutral, honest, not error-red (OOC-*).
3. **No-clear-obligations** honest empty state; **low-confidence** banner ("treat as a starting point").
4. **Conflict** paired cards under "These frameworks pull in different directions."
5. **Persistent "Corpus as of [date]"** indicator (hover = framework versions); **"Decision support, not legal advice"** with every result, at the point of answer.
6. **Empty/error states** everywhere; errors offer retry and never render a partial fabricated answer.

**Acceptance gate:** run the CLR-*, OOC-*, ADV-*, CONF-* golden items through the UI — each produces its correct *behavior* (clarify / refuse / no-verdict / paired-conflict), matching the eval expectations.
**Commit point G.**

---

## H. Phase 7 — Eval page, CI gate & instrumentation

**Goal:** make the quality visible and regression-proof (PRD §8.8, §11.3, §14).
**Owner:** Claude Code.

**Steps**
1. **CI job:** on push, run the harness against a deployed preview; **fail the build** if groundedness <95%, citation <90%, or correct-refusal <90%. Write results to `eval_results` (metric, target, value, run_date, `snapshot_id`, `judge_prompt_version`).
2. **In-product evaluation page:** reads `eval_results` — each metric with target, latest value, run date, plain-language method, and representative example questions from the golden set. This is the "so what" credibility surface.
3. **Instrumentation:** anonymous counters — map-completion, clarifying-question, citation-click-through, follow-up, refusal-encounter, errors-by-state, time-to-first-obligation. **Log chunk IDs + scores + snapshot_id for tracing, never the user's description.**
4. **Contact affordance** (single, unobtrusive).

**Acceptance gate:** eval page shows live numbers tied to the active snapshot; a deliberately regressed change fails CI.
**Commit point H.**

---

## I. Phase 8 — Follow-ups, hardening & launch prep

**Owner:** Claude Code + you.

**Steps**
1. **Follow-up questions** (scoped + general) through the **same** grounding/validation/refusal rules (FR-6.3); Opus 4.8, or Sonnet 5 if volume/cost warrants.
2. **Rate limiting / cost caps** on the generation endpoint (per-session/IP); confirm prompt-cache hit rate (`cache_read_input_tokens > 0`).
3. **Accessibility** pass (WCAG AA, keyboard nav incl. citations + source viewer, no color-only meaning, contrast on highlights); responsive desktop/mobile (source viewer → full-height sheet on mobile).
4. **Prompt-injection posture check** (user text is data, never instructions; no side-effectful tools); privacy check (nothing persisted about the user).
5. **Full regression** eval run; latency check under load; **corpus-refresh dry run** (re-ingest → validate → promote a new snapshot without downtime).

**Acceptance gate:** all gating metrics green, latency targets met, a11y clean, a snapshot refresh works end-to-end.
**Launch commit.**

---

## J. Cadences & guardrails (apply throughout)

- **Eval every phase, not just Phase 7.** After any change to ingestion, retrieval, prompts, or corpus, run the relevant golden subset. The metrics are the definition of done.
- **Snapshots are immutable; promote only on a clean validation.** Every answer records its `snapshot_id`.
- **Prompt-cache hygiene:** stable system prefix cached; user text + snapshot date strictly after the breakpoint; verify hits.
- **Never let a failure fabricate.** Every path ends in a grounded answer, an honest gap, a refusal, or a retry (system design §15).
- **Sync discipline (§A.2) is not optional** — serialize `main` access; pull after any Lovable edit.
- **Model/label/weight changes go through config**, then get re-tuned against the golden set — not hand-set in pipeline code.
- **Scope is binding.** No auth, saved sessions, comparison view, framework browser, suggested questions, or extra frameworks in the MVP (PRD §4.2).

---

## K. First three moves (to start now)

1. **You + Lovable:** create the minimal project, enable Cloud, connect GitHub, set the three secrets, decline auth. Confirm a round-trip edit syncs both ways.
2. **You + Claude Code:** clone locally, move `corpus/` + `evals/` + `design/` + `architecture/` into the repo and commit; establish the repo structure (§A.4) and the seams (§A.5); link the Supabase CLI; write + push migration `0001_schema.sql` and confirm it applies.
3. **Claude Code (Phase 1):** build the GDPR parser → chunk → embed → load → validate, and hit **Acceptance gate B** (`Art. 22(1)` resolves to exact text with a working citation). That single green gate proves the whole data spine.

From there, walk B → I in order, treating each acceptance gate as the permission slip for the next phase.

---

*This plan front-loads the existential risk: Phases 1–3 prove groundedness and verifiable citation on one framework before a single extra framework or polished screen is built. If Phase 3's gate is green, the rest is execution; if it's red, you've spent the least possible effort to learn that — which is exactly where the effort belongs.*
