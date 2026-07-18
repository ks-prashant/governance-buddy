# Grounded Governance — Build Plan

**For the workflow:** minimal scaffold in **Lovable** (Lovable Cloud) → two-way **GitHub** sync → **Claude Code** authors most code and commits → Lovable only pulls changes, holds secrets/keys, and gives a live preview.
**Companions:** `architecture/SYSTEM_DESIGN.md` (the what/why), `evals/` (the quality gate), `design/DESIGN_AND_BRAND_GUIDELINES.md` (the look/voice), the PRD (the spec).

> **How to use this.** §A sets up the workspace and the rules that keep the three-way sync from fighting itself. §B–§J are phases, in de-risking order. Each phase has **Owner · Steps · Files · Secrets · Acceptance gate · Commit point.** Do them in order — later phases assume earlier ones. Hand each phase to Claude Code as a scoped task; don't start a phase until the previous phase's acceptance gate is green.
>
> **Verify-at-build flags.** A few Lovable Cloud / Supabase mechanics (how migrations and edge functions deploy, exact UI labels) evolve; where the exact flow matters I give the robust path (**Supabase CLI**) plus the Lovable path, and mark it **[verify]**. The architecture doesn't depend on which you pick.
>
> **[Confirmed at build — corrects §A.0 below]** Lovable scaffolded **TanStack Start** (not plain React+Vite), and the BFF/orchestration layer is **TanStack Start server routes** (`src/routes/api/*.ts`, `server: { handlers: { POST } }`) plus plain modules in `src/server/pipeline/*.ts` — **not Supabase Edge Functions**. The deploy target is Cloudflare Workers. Wherever the phases below say `_shared/foo.ts` or "edge function", read it as `src/server/pipeline/foo.ts` and "TanStack server route" respectively — the pipeline logic and phase sequencing are unaffected, only the file locations and deploy mechanism differ from what was assumed when this plan was first written. See `architecture/SYSTEM_DESIGN.md` §4.1 for the full reasoning (Workers have no filesystem, which is *why* ingestion §B below runs offline rather than as an in-app endpoint).

---

## 0. Status & session log (read this first in a new session)

**Standing instruction:** whenever a phase (§A–§J) is completed, or a session ends
mid-phase with meaningful progress, add a dated entry at the TOP of the session log
below (most recent first) before ending the turn. An entry should say: what phase,
what was actually done, what was learned/fixed, the current blocker (if any) and what
the next concrete action is, and the latest commit SHA. A fresh Claude Code session
should be able to read this section alone and know exactly where to resume — without
re-deriving it from git log or re-reading every phase section.

**Current status at a glance:**

| Phase | Status | Gate result |
|---|---|---|
| A — Workspace setup | ✅ Done | trivial deploy + front end load confirmed |
| B — GDPR ingestion | ✅ Done | 99/99 articles, 173/173 recitals, 22/22 golden anchors |
| C — Retrieval | ✅ Done | 7/7 retrieval-hit-rate on GDPR slice |
| D — Grounded generation + validation | 🟡 Built, fixed, code-reviewed — **formal eval gate not yet re-measured** | first run: groundedness 93.3% FAIL, correct-refusal 83.3% FAIL, citation 93.8% PASS. 3 root-cause fixes applied + deployed since. |
| E — Full corpus + cross-framework | 🟡 Parsers done (4/4) + validate gate green on all 5; embed/load/promote + 5-dim decomposition + conflicts + full eval still to do (embed/load blocked on payment) | all 5 frameworks pass validate: golden anchors 22/22 GDPR · 27/27 EU AI Act · 9/9 CSF · 6/6 SSDF · 9/9 AI RMF |
| F — Hero UI | ⬜ Not started | — |
| G–J | ⬜ Not started | — |

### Session log (most recent first)

**2026-07-18 (latest) — Cost-scoped Phase D eval plan + TEMPORARY generation-model switch.**
User funded the Anthropic account with **$5** (payment partially resolved) and asked for a
rigorously cost-scoped eval plan. Costed the harness from the actual call structure
(`evals/run_eval.mjs`): the judge is Sonnet 5 (harness default), 1 call for refuse/clarify
items and 3 (Prompt A+B+C) for answer items; the product pipeline only runs the expensive
`generate` step on *answer* items (refusals are routed, clarify stops early). The Phase D
24-item GDPR subset is **7 answer / 13 refuse / 4 clarify**, so only **7 generations** — est.
**~$1.6, worst case ~$3.4**, fits $5 with room for one partial re-run. **Decision — run the
Phase D 24-item GDPR gate; DEFER the full 64-item Phase E eval** (it's both blocked on the
unloaded 5-framework corpus and unaffordable — ~30+ generations ≈ $6–12).
**⚠️ TEMPORARY generation-model switch (revert before launch):** per user's cost decision,
`config.ts` `MODELS.generate` default changed **`claude-opus-4-8` → `claude-sonnet-5`** to run
the eval cheaply. **This means the Phase D gate result will certify the Sonnet-5 config, NOT
the shipping Opus-4.8 config.** The user's explicit instruction: keep it on Sonnet for now,
and **once the whole app is ready, switch `generate` back to `claude-opus-4-8` and re-run the
evals** before treating the gate as final. (Follow-up model left on Opus — not exercised by
the eval.) Do NOT mark Phase D's gate as officially met on a Sonnet run — it's an interim
signal until the Opus re-run.
**Cost-saving measures for the run:** judge stays Sonnet 5 (never Opus); run once, then
re-run ONLY failing IDs via `SUBSET_IDS` (biggest lever); prompt-cache the generate prefix;
skip Batch API (savings not worth the rework at this scale). **Verify-first:** a ~free direct
Anthropic call (harness judge key) + one product `/api/generate` call (~$0.15, exercises the
*deployed* product's own key — a separate secret) to confirm BOTH keys have credit before
firing all 24. **Prereq before the run:** the Sonnet config must be deployed live (sync →
deploy → verify `latest_commit_sha`), since the eval hits the deployed endpoint, not local.

**2026-07-18 (later) — Phase E step 1: the other four parsers (deterministic structuring).**
With evals parked (Anthropic payment still unresolved), moved forward on the part of Phase E
that needs no API credits: the framework-specific parsers (§E step 1) and the deterministic
validate gate (§E step 2's structural half). Built all four remaining parsers to the same
`ParsedFramework` interface as `gdpr.ts`, each producing a committed, reviewable
`corpus-build/<fw>.json` with NO embeddings:
- `eu-ai-act.ts` — Chapter→Section→Article→paragraph(→inline points) + Recitals + Annexes.
  **113/113 articles, 180/180 recitals, 13 annexes** (306 parents, 784 children). Reuses the
  GDPR paragraph/point logic; Act-specific surface differences handled (page furniture
  `N/144`/`ELI:`/`OJ L,`; inline chapter titles; bare `SECTION n` + next-line title; article
  titles on their own line; inline-body articles like 64/113 where the body sits on the
  heading line). Annex III(N) areas parsed so `Annex III(5)(b)` resolves. Known cosmetic:
  12 amendment articles (102–113, non-golden) keep a boilerplate OJ self-citation — real
  text, not furniture, left intact.
- `nist-csf.ts` — Function→Category(parent)→Subcategory(child). **22 categories, 106
  subcategories** (matches CSF 2.0 exactly). Bullet/`XX.YY`-id tokenizer with page-furniture
  stripping; parens disambiguate category ids `(PR.DS)` from subcategory ids `PR.DS-01`.
- `nist-ssdf.ts` — Practice group→Practice(parent)→Task(child). **19 practices, 42 tasks**
  (matches SP 800-218 v1.1). The messy one, as the plan warned: pdftotext flattens the
  3-column table and batches each page's tasks after all its headers, so tasks are filed
  under their practice by **id prefix** (`PW.4.1`→`PW.4`), never by position; "Example N:"
  is a cut marker (some pages omit the "Notional Implementation Examples" header); deprecated
  "Moved to …" tasks dropped.
- `nist-ai-rmf.ts` — the 7 trustworthiness characteristics (§3.1–3.7, the units the golden
  set cites, with en-dash normalized so `Section 3.7 (Fair - with Harmful Bias Managed)`
  matches) + the Core (GOVERN/MAP/MEASURE/MANAGE functions as parents, **72 subcategories**
  filed by prefix, same as SSDF). 11 parents, 79 children.
Enhanced `ingestion/validate.ts` from GDPR-only anchor logic to a framework-aware
`anchorResolves()` (exact → Article/Annex point+range reduction → prefix → hierarchy grain:
`GOVERN (GV)`, `Chapter V (…)`, `X function`, `PO (…)` group codes, `A / B` slash-lists →
whole-framework citations like `… Core`/`(voluntary framework)`/`practice groups`). **All 5
frameworks now pass validate** (GDPR still 22/22 — no regression). `bunx tsc --noEmit` clean;
each parser also runs clean under bun.
**Two load-time issues flagged for when embed/load is unparked (parser output is fine; these
are downstream):** (1) the combined 5-framework corpus has **435 cross-framework duplicate
child `citation_label`s** (GDPR `Art. 5(1)` vs EU AI Act `Art. 5(1)`), which violates
`chunks_citation_label_unique_idx (snapshot_id, citation_label)` — the fix is to make that
index `(snapshot_id, framework_id, citation_label)` (a one-line migration), since
`framework_id` already disambiguates and display stays framework-native. (2) `ingestion/run.ts`
+ `load.ts` promote **one snapshot per framework** (each archives the previous), but Phase E
needs all five in ONE snapshot — needs a combined-snapshot load path. Total corpus so far:
**630 parents, 1,573 children** across five frameworks.
**Not committed as of writing this entry** — commit immediately after. **Next action:** commit
+ push + sync; the remaining Phase E work (embed/load/promote a single 5-framework snapshot,
turn on the DR-4 five-dimension decomposition, seed `conflicts`, and the full 64-item eval)
stays parked on Anthropic/Voyage credits — resume it once payment is resolved (verify with a
direct API test first, per the standing note).

**2026-07-18 — Phase D fixes verified + full codebase review.** Anthropic credits were
blocked most of this session (both the local eval-judge key and the deployed product's
own key hit "credit balance too low" on Anthropic's side; confirmed via direct API test,
not assumption). Per user instruction, did NOT re-run the formal eval — instead did a
full static code review of everything built so far (all of `src/server/pipeline/*.ts`,
both API routes, `ingestion/{load,validate}.ts`) and fixed 8 real bugs/gaps found by
tracing logic end-to-end, verified via `bunx tsc --noEmit` + `bun run build`:
- `generate.ts`: removed an overly-strict zod `.min(1)` on `supporting_chunk_ids` that
  would crash the ENTIRE response if the model ever emitted one obligation with zero
  ids — the existing post-fence filter already handles this gracefully, the schema
  constraint was pre-empting it.
- `generate.ts`: `conflicts_with` wasn't validated against the known chunk-id set the
  way `supporting_chunk_ids` is — fenced it the same way.
- `retrieve.ts`: wrapped `matchByCitation` in try/catch — a citation-pin RPC hiccup
  shouldn't crash the whole retrieval (it's an enhancement, not load-bearing).
- `config.ts`: fixed a stale "NOT YET WIRED" comment on `relevanceFloor` — it's been
  wired into `pipeline.ts`'s refusal gate since Phase D landed.
- `pipeline.ts`: `getSnapshotDate` silently swallowed its Supabase error; now logged.
- `routes/api/generate.ts`: wrapped the dynamic imports + non-streaming path in
  try/catch, matching `retrieve.ts`'s pattern (a module-load failure was previously
  falling through to the generic HTML error page instead of clean JSON).
- `ingestion/validate.ts`: **the most consequential find** — the validate gate checked
  child `citation_label` uniqueness but never PARENT label uniqueness. `load.ts` joins
  children to parents via a `Map` keyed by parent `citation_label` — a collision there
  would silently link children to the WRONG parent with zero error, anywhere. Added the
  missing check to `validate.ts`, plus a defensive throw in `load.ts` itself (defense in
  depth, in case `load.ts` is ever run without the gate). Not yet triggered by GDPR (no
  collisions there), but a real risk once Phase E's more complex hierarchies (Annexes,
  subcategories, task groups) are parsed.
- `evals/run_eval.mjs`: stale header comment referencing "TODO adapters" that are
  already wired; corrected.
Latest commit: (see git log — this session's fixes not yet committed as of writing this
entry; commit immediately after, before doing anything else in a resumed session).
**Next action:** commit + push + sync + deploy these review fixes, then wait for
Anthropic credits to actually resolve (verify with a direct `curl`/`fetch` test, not by
assuming a "credits added" claim took effect) before re-running the Phase D eval.

**2026-07-18 (earlier) — Phase D built + first eval run.** Built the full grounded-
generation pipeline streaming-first (`generate.ts`, `validate.ts`, `assemble.ts`,
`pipeline.ts`, `routes/api/generate.ts`). Spot-checked manually (answer/refuse/clarify
all correct). Wired `evals/run_eval.mjs` to the real deployed endpoint + a pinned judge
model. Ran the actual 24-item GDPR-only subset (DL-01..04, ADV-02/03/12, OOC-01..12,
ADV-09, CLR-01/02/03/05) for the first time: groundedness 93.3% FAIL, correct-refusal
83.3% FAIL, citation 93.8% PASS. Diagnosed every failing item by hand (not guessed) and
fixed 3 real gaps: (1) `understand.ts` bare-compliance-questions ("is our app
compliant?") were classified `direct_question` (always-sufficient), bypassing the
clarify gate — reclassified; also found+fixed the tool-schema's own field descriptions
still contradicting the fixed system prompt. (2) clarifying questions sometimes bundled
2+ asks into one sentence — added an explicit anti-bundling instruction. (3) OOC-04/06
("close-neighbor trap" items — ISO certs, UK GDPR) produced a full obligation map from
tangentially-adjacent GDPR material instead of refusing — added a generation-prompt rule
against generalizing from a different-but-similar-sounding regime. Also fixed a harness
bug: judge `max_tokens` was 2000, too low for Prompt B's per-claim breakdown, risking a
truncated response being misread as a false "contradicted" claim (confirmed via a manual
re-run at 4000 tokens on DL-01: zero contradicted claims). Raised to 6000. ADV-12's
failure is likely a subset-curation error on my part (its `must_include` assumes EU AI
Act corpus/knowledge that doesn't exist until Phase E) rather than a pipeline defect —
re-evaluate once Phase E lands. Deployed and confirmed live via `get_project`'s
`latest_commit_sha`. **Learned mid-session:** `deploy_project` deploys the builder
platform's own synced sandbox tree, not directly from GitHub — always sync first, then
deploy, then verify the deployed `latest_commit_sha` matches before trusting a live test.

**2026-07-17 — Architecture review + doc sync + Phase C perf/security fixes.** Stepped
back after Phases A–C to review the whole system at once rather than only
phase-by-phase. Found and fixed a CRITICAL security issue (RLS disabled on all tables
did not mean server-only on Supabase — its default template grants anon/authenticated
table access regardless of RLS state; the public non-secret anon key could read+write
every table, verified empirically). Fixed: enable RLS with zero policies on every
table (`service_role` bypasses RLS regardless, so server-side code is unaffected).
Measured real latency (4.2–9.5s range across iterations) and made two real fixes
(batch embedding calls; parallelize `understand()` + snapshot lookup) — confirmed via
direct measurement, not assumption. Synced `architecture/SYSTEM_DESIGN.md`,
`docs/PRD.md`, and this build plan to reflect what was actually built vs. originally
assumed (TanStack Start on Cloudflare Workers, not Supabase Edge Functions; forced
tool-use as the structured-output mechanism; the two retrieval bugs found in Phase C
itself — keyword search silently AND-ing every word, and no citation-aware lookup for
named-unit queries).

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

- Models: `MODEL_CLASSIFY=claude-haiku-4-5`, `MODEL_GENERATE=claude-opus-4-8`, `MODEL_VALIDATE=claude-haiku-4-5`, `MODEL_FOLLOWUP=claude-opus-4-8` (Sonnet 5 as a cost lever later). **[Confirmed at build]** all working model IDs. **[⚠️ TEMPORARY 2026-07-18]** `MODEL_GENERATE` default is currently **`claude-sonnet-5`**, not Opus 4.8 — a cost measure to run the Phase D eval within a ~$5 budget. **Revert to `claude-opus-4-8` before the launch/final eval** (see §0 session log).
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
**Commit point D. [🟡 Built + spot-checked + code-reviewed; gate NOT yet formally met.]** Full detail in §0's session log — summary: first real eval run (24-item GDPR subset) scored groundedness 93.3%/correct-refusal 83.3% (both FAIL), citation 93.8% (PASS). Root-caused and fixed 3 real gaps (a compliance-question classification gap bypassing the clarify path, bundled clarifying questions, and a "close-neighbor trap" generation gap producing obligations from the wrong regime's adjacent material) plus a harness bug (judge token truncation) and, in a follow-up full codebase review, 8 further bugs/gaps (see §0). All fixes deployed and confirmed via `get_project`'s `latest_commit_sha`. **Not yet re-measured against the gate** — blocked on Anthropic account credits during this session; re-run `evals/run_eval.mjs` with the `SUBSET_IDS` below once credits are confirmed working (test with a direct API call first, don't assume). GDPR Phase D subset ids: `DL-01,DL-02,DL-03,DL-04,ADV-02,ADV-03,ADV-12,OOC-01,OOC-02,OOC-03,OOC-04,OOC-05,OOC-06,OOC-07,OOC-08,OOC-09,OOC-10,OOC-11,OOC-12,ADV-09,CLR-01,CLR-02,CLR-03,CLR-05` (24 items — excludes cross-framework/other-framework/CONF items, which need Phase E's corpus).

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
