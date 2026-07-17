# Grounded Governance — System Design

**Author:** AI systems architecture · **Companions:** the PRD (`grounded-governance-prd.md`), the eval package (`evals/`), the design guidelines (`design/DESIGN_AND_BRAND_GUIDELINES.md`).
**Status:** design of record for the Phase-1 MVP (PRD §16).

> **How to read this.** §1–§3 are the shape and the principles. §4 is the stack with tradeoffs. §5–§8 are the four subsystems (ingest, retrieve, generate/ground, orchestrate). §9–§16 are the cross-cutting concerns (data model, cost, evals, ops, security, failure, a full request trace). §17–§18 are the build order and the open risks. Every decision is written as **Decision / Why / Tradeoff** so you can revisit it.
>
> **Version-sensitive facts** (model IDs, prices, the Citations API, embedding model names) are current as of this writing and flagged where they matter — confirm them at build time. The *architecture* does not depend on the exact versions; the *cost math* does.

---

## 1. What we are building, in one paragraph

A single-session web app where a user describes an AI system (or asks a question) and receives a **prioritized, clause-cited map of governance obligations** drawn from five frameworks, with honest refusal/uncertainty/conflict handling and one-click source verification. The hard part is not the chat — it is making the output **grounded by construction**: every substantive claim must be traceable to a specific retrieved paragraph, the system must refuse rather than fabricate, and it must never assert a compliance verdict. The architecture is organized entirely around making those guarantees structural rather than aspirational.

---

## 2. Architecture at a glance

```
                         ┌────────────────────────────────────────────────────────┐
   User (browser)        │                   Web app (UI + BFF)                    │
   ───────────────▶      │  input · streaming map · source viewer · eval page      │
        ▲                └───────────────┬────────────────────────────────────────┘
        │ SSE (streamed cards)           │  orchestration (server)
        │                                ▼
        │        ┌───────────────────────────────────────────────────────────────┐
        │        │  1. QUERY UNDERSTANDING   (classify · sufficiency · decompose) │  Haiku 4.5
        │        │  2. RETRIEVAL             (hybrid + metadata filter + rerank)  │  pgvector + BM25 + reranker
        │        │  3. GROUNDED GENERATION   (obligation map, cite chunk IDs)     │  Opus 4.8 (structured out)
        │        │  4. CITATION VALIDATION   (claim ⊢ cited chunk?)               │  Citations API / Haiku
        │        │  5. ASSEMBLY              (tiers · labels · conflicts · gaps)  │  app code
        │        └───────────────┬───────────────────────────────────────────────┘
        │                        │ reads
        │                        ▼
        │        ┌───────────────────────────────────────────────────────────────┐
        └────────│  Postgres + pgvector : chunks, parents, metadata, embeddings   │
                 │  (immutable corpus snapshot, versioned)  +  eval_results table  │
                 └───────────────────────────────────────────────────────────────┘
                                 ▲
                                 │ offline, on-demand
                 ┌───────────────┴───────────────────────────────────────────────┐
                 │  INGESTION PIPELINE : parse → structure → chunk → embed → load │
                 │  EVAL HARNESS (Batch API) → writes eval_results → in-product page│
                 └───────────────────────────────────────────────────────────────┘
```

The request path is a **staged pipeline**, not an agent loop. Every stage is deterministic in what it *may* do; the model's freedom is deliberately fenced (it may only cite chunks we handed it, it may only answer from provided text). That fencing is the product.

---

## 3. Architectural principles (the tie-breakers)

1. **Ground by construction, not by instruction.** Don't just *tell* the model to cite — make it structurally unable to cite anything it wasn't given, and validate every claim against its cited source before display. Grounding is enforced by the pipeline (constrained citation + validation pass), not trusted to a prompt.
2. **Retrieval decides truth; generation only phrases it.** The corpus is the sole source of substantive claims (PRD DR-11). The model's job is to select, rank, and explain retrieved obligations — never to supply governance facts from parametric memory.
3. **Citations are data we own, not text the model writes.** The clause label, hierarchy, version, and URL shown in the source viewer come from *our chunk metadata*, keyed to the exact span the model cited. A hallucinated citation is therefore impossible, not merely unlikely.
4. **Refusal and "no clear obligations" are first-class outputs**, produced by explicit gates, not emergent from a reluctant model.
5. **Stage the pipeline; stream the result.** Cheap/fast models and retrieval run first; the expensive grounded-generation step streams cards so the first tier renders within the latency budget.
6. **Everything is snapshot-versioned.** The corpus is immutable per snapshot; every answer records the snapshot it was produced against; nothing claims current law beyond the label (PRD §5, §7).
7. **Single session, nothing retained.** No accounts, no persistence of user descriptions beyond the session (PRD §13). This simplifies the whole system and is a privacy feature, not a limitation.

---

## 4. The stack — decisions and tradeoffs

The PRD §12 suggests a buildable stack; here it is made concrete, with the roads not taken.

### 4.1 Application / hosting

- **Decision:** a full-stack TypeScript web app (React front end + a thin server/BFF layer that owns orchestration and holds all API keys), built with a rapid full-stack builder (e.g. Lovable) over managed hosting. Server-Sent Events for streaming.
- **Why:** the orchestration (query→retrieval→generation→validation) must run server-side — keys can't touch the browser, and the citation-validation logic is trusted code. SSE fits the "stream the first tier" requirement and is simpler than websockets for one-directional streaming.
- **Tradeoff:** a builder accelerates UI but the grounding pipeline is custom code regardless — don't let the builder tempt you into doing retrieval/generation client-side. Keep a hard line: **UI in the builder, pipeline in server functions.**

### 4.2 Storage & retrieval

- **Decision:** **Postgres with `pgvector`** (dense) + Postgres full-text search / **BM25** (keyword) in one database (a managed Postgres such as Supabase). HNSW index for vectors.
- **Why:** the corpus is tiny (~350 pages → low tens of thousands of child chunks). One database that does both dense and lexical retrieval avoids a second system (a dedicated vector DB) and lets metadata filtering, hybrid search, and parent lookup all be plain SQL joins. HNSW gives fast ANN at this scale with trivial memory.
- **Tradeoff:** a purpose-built vector DB (Pinecone/Weaviate/Qdrant) scales further and ships rerank/hybrid features out of the box — but at this corpus size that's operational weight for no benefit, and it splits your metadata from your vectors. Revisit only if the corpus grows an order of magnitude (Phase 3). IVFFlat is the alternative index — cheaper to build, worse recall/latency; prefer HNSW.

### 4.3 Embeddings

- **Decision:** a hosted embedding model specialized for legal/long-form retrieval — **Voyage AI** (Anthropic's recommended embeddings provider; consider a legal-tuned model such as `voyage-law-2`, or the current general `voyage-3`-class model). *Confirm the exact current model name and dimensions at build time.*
- **Why:** Claude has no embeddings endpoint. This corpus is dense legal/technical prose where a domain-tuned embedder measurably improves recall of the *right clause* — which directly moves the retrieval-hit-rate and groundedness metrics. Embed the **child chunks** only.
- **Tradeoff:** a general-purpose embedder (OpenAI, Cohere) is fine and swappable; the embedding model is an isolated dependency behind an `embed(text)` interface, so you can A/B two embedders against the golden set (§12) and pick by retrieval-hit-rate. Keep the model id + dimension in chunk metadata so a model change forces a clean re-index rather than mixing vector spaces.

### 4.4 Generation models (routed by stage)

Route by difficulty; don't pay Opus prices for classification. Model IDs/prices current as of writing (confirm at build):

| Stage | Model | Why this tier |
|---|---|---|
| Classify input · sufficiency check · query decomposition | **Haiku 4.5** (`claude-haiku-4-5`, ~$1/$5 per M) | Cheap, fast, structured-output-capable; these are easy, latency-critical calls on the critical path. |
| Rerank retrieved candidates | **A dedicated reranker** (Voyage/Cohere rerank) — *or* Haiku as a fallback | Rerankers are cheap, purpose-built, and far faster than an LLM rerank. |
| **Grounded generation** (the obligation map, the rationale, applicability, conflict detection) | **Opus 4.8** (`claude-opus-4-8`, ~$5/$25) with **adaptive thinking** + **`effort: high`** | This is the quality-critical, cross-framework-synthesis step — the whole product's value. Use the strongest model with thinking on. |
| Citation-validation pass (claim ⊢ chunk) | **Haiku 4.5** or the **Citations API** on Opus | A constrained entailment check; cheap model + strict prompt is enough, and it's parallelizable. |
| Follow-up answers | **Opus 4.8** (or **Sonnet 5**, `claude-sonnet-5`, ~$3/$15, for cost) | Same grounding rules as the map; Sonnet 5 is the cost-down lever if follow-up volume is high. |

- **Tradeoff:** you could run the whole pipeline on one model for simplicity. Don't — the map step is where quality matters and the classify/validate steps are where volume (and cost) accrue. Routing keeps quality high and cost bounded. Keep every model call behind a `model` config value so you can re-tune the routing against evals.

### 4.5 The one API capability that shapes the design: **Citations**

Anthropic's **Citations API** (`citations: {enabled: true}` on document content blocks) makes the model quote and cite **exact spans of the documents you provide**, returning `cited_text` plus a character/page location back into *your* document. This is the mechanism that turns principle #3 from a hope into a guarantee: the model cannot cite text it wasn't given, and the citation resolves to a precise offset in a chunk whose metadata we control.

- **Constraint that shapes the pipeline:** Citations mode is **incompatible with structured JSON output in the same call** (the API rejects the combination). So we cannot get "structured map + native citations" from one call. The resolution is the **two-step generation** in §7: structured output builds the map skeleton (referencing chunk IDs), and Citations (or an entailment check) validates each claim against its chunk. Structure and proof live in different calls, on purpose.

---

## 5. Subsystem 1 — Corpus ingestion pipeline (offline)

The highest-leverage, least-glamorous part. Retrieval quality and citation precision are capped by how well the corpus is structured here (PRD DR-1–DR-3).

### 5.1 The central decision: deterministic structuring over LLM parsing

- **Decision:** parse each framework with **framework-specific, deterministic parsers** into its real hierarchy, and treat structuring as a **curated, verifiable build artifact** — not an LLM guess. The corpus is five documents; hand-tuned parsers per document are tractable and produce clean, auditable hierarchy.
- **Why:** citation accuracy (target ≥90%) and the source viewer's credibility depend on the hierarchy path being *exactly right* (GDPR Article 22(1); EU AI Act Annex III(5)(b); NIST CSF `PR.DS-01`; SSDF `PW.4`). An LLM chunker that occasionally mis-assigns a paragraph to the wrong article silently corrupts every citation to it. Deterministic parsing is inspectable and repeatable; you can diff two builds.
- **Tradeoff:** hand-parsers are per-document work and brittle to source reformatting. Mitigation: the parsers are small, the sources change rarely (versioned snapshots), and a validation step (below) catches drift. An LLM can *assist* (e.g. proposing structure for the messy multi-column NIST SSDF tables) but its output is reviewed and frozen, never trusted live.

### 5.2 The hierarchy each framework parses into

| Framework | Natural hierarchy → citation anchor |
|---|---|
| GDPR | Chapter → Article → paragraph → point (e.g. `Art. 22(2)(a)`) + Recitals |
| EU AI Act | Chapter → Section → Article → paragraph → point, plus **Annexes** (e.g. `Annex III(5)(b)`) |
| NIST AI RMF | Function (GOVERN/MAP/MEASURE/MANAGE) → Category → Subcategory (e.g. `MAP 1.1`) + the 7 trustworthiness characteristics (§3.x) |
| NIST CSF 2.0 | Function → Category → Subcategory (e.g. `PR.DS-01`) |
| NIST SSDF | Practice group (PO/PS/PW/RV) → Practice → Task (e.g. `PW.4.1`) |

### 5.3 Parent–child chunking (PRD DR-2)

- **Child chunk** = the smallest semantically coherent unit (a paragraph/point/subcategory). This is what gets **embedded and retrieved** — small, precise, one idea.
- **Parent unit** = the surrounding article/section/practice. This is what gets **handed to generation** for context (and is the citation-validation target).
- **Decision:** retrieve over children, generate over parents. Store both, linked by `parent_id`.
- **Why:** small children maximize retrieval precision (the query matches one clause, not a whole article); parents give the model enough context to reason and to phrase the obligation correctly, and are the unit the user opens in the source viewer.
- **Tradeoff:** naive fixed-size chunking is simpler but shreds legal structure and produces citations that point at arbitrary windows. Structure-aware parent/child is more work and worth it here because the citation *is* the product.

### 5.4 Metadata carried on every chunk (PRD DR-3)

`framework_id · framework_version · snapshot_date · hierarchy_path · citation_label · source_url/anchor · parent_id · char offsets · embedding_model_id`. This metadata is the single source of truth for the source viewer and the corpus indicator — the model never generates it.

### 5.5 Build, validate, freeze

`parse → structure → chunk → embed → load`, runnable on demand for a corpus refresh. **A validation step gates the build:** every child resolves to a parent; every citation_label is unique and well-formed; a sample of known anchors (reuse the golden set's `expected_citations` from `evals/`) resolves to the right text; counts match expectations. A snapshot that fails validation is not promoted. The promoted snapshot is **immutable** and identified by `snapshot_date`; answers reference it.

---

## 6. Subsystem 2 — Retrieval (online, on the critical path)

Turns a description into the right handful of parent clauses across five frameworks. Implements PRD DR-4–DR-8.

### 6.1 Query understanding (one cheap call)

- **Decision:** a **single Haiku structured-output call** does classification + sufficiency + decomposition together, returning: `{input_type: system_description|direct_question, sufficient: bool, missing_attribute?: string, clarifying_question?: string, subqueries: {dimension, query}[]}`.
- **Sufficiency (PRD §8.2):** the model judges whether the description supplies function, data, decision-impact-on-people, and deployment region. If a *critical* attribute is missing, it returns one `clarifying_question` and the pipeline **stops and asks** — no map is generated. This is a hard gate, not a suggestion.
- **Decomposition (PRD DR-4):** a system description is fanned into sub-queries spanning the five governance dimensions (privacy, AI regulation, AI-risk, cybersecurity, secure-development) so cross-framework coverage is produced *by design*. A direct question is expanded/rewritten for recall (DR-5) instead.
- **Why one call:** it's on the critical path before anything renders; collapsing three easy decisions into one Haiku call keeps pre-retrieval latency ~sub-second.
- **Tradeoff:** a single call can conflate the decisions; if sufficiency quality suffers, split it out. Measured by the clarification-precision diagnostic in `evals/`.

### 6.2 Hybrid retrieval + fusion (PRD DR-6)

- **Decision:** for each sub-query run **dense** (pgvector cosine over child embeddings) **and** **keyword** (Postgres FTS/BM25) retrieval, and fuse with **Reciprocal Rank Fusion (RRF)**.
- **Why:** dense catches semantic matches ("scores loan applicants" ↔ "creditworthiness"); keyword catches exact legal terms and identifiers ("Article 22", "SBOM", "PR.DS") that embeddings blur. RRF needs no score calibration between the two and is robust.
- **Tradeoff:** RRF is a simple, unweighted fusion; a learned or weighted fusion could do marginally better but adds tuning surface. Start with RRF; revisit only if retrieval-hit-rate lags.

### 6.3 Metadata filtering (PRD DR-7)

When the user scopes to a framework ("under GDPR, …"), filter retrieval by `framework_id` in the SQL `WHERE`. Cheap and exact — a plain predicate, no re-embedding.

### 6.4 Rerank + parent expansion (PRD DR-8)

- **Decision:** take top-k children per sub-query, **rerank** the merged candidate pool with a cross-encoder reranker against the *original* user description, keep the top N, then **expand each survivor to its parent** for generation.
- **Why:** first-stage retrieval favors recall; the reranker restores precision by scoring true query↔clause relevance, which directly lifts groundedness (the model gets fewer, better clauses). Parent expansion gives the generator context and the exact unit the user will open.
- **Tradeoff:** reranking adds a hop (~100–300ms) and a dependency; at this corpus size it's worth it for the precision. LLM-as-reranker is an alternative but slower and pricier — prefer a dedicated reranker.

The retrieved parent set (with full metadata) is the **only** substantive input to generation. Everything downstream cites from this set or refuses.

---

## 7. Subsystem 3 — Grounded generation & validation (the core)

Where the product's promise is kept. Implements PRD DR-9–DR-11 and §8.3–§8.4. Two steps, because structure and citation-proof can't share one call (§4.5).

### 7.1 Step A — the obligation map (structured output, constrained citation)

- **Decision:** **Opus 4.8** with **structured output** (`output_config.format`, a strict JSON schema) and adaptive thinking at `effort: high`, given the reranked parent set (each parent tagged with its `chunk_id` + metadata). It returns a map:
  ```
  { restated_understanding, obligations: [ {
      statement,                 // plain-language obligation
      rationale,                 // "why this applies to YOUR system", referencing described attributes
      supporting_chunk_ids: [],  // MUST be from the supplied set — the citation anchors
      applicability: Direct|Inferred|Possible,
      impact: high|medium|low,
      conflicts_with?: chunk_id  // flags a framework tension
    } ], gaps: [], overall_confidence } 
  ```
- **The grounding fence:** the schema forces every obligation to reference `supporting_chunk_ids` **from the supplied set only**. The model selects citations; it does not author them. Because we hold each chunk's metadata, the citation chip and source-viewer payload are built from trusted data keyed to the model's selection — **hallucinated citation locations are structurally impossible** (principle #3).
- **Restated understanding (PRD §6.1 Step 4)** and **gaps (§6.1 Step 6)** are fields of the same object, so the confirmation and the honest "what's not covered" are produced in-band, not bolted on.
- **Why structured output here:** the map's tiers, labels, grouping, and conflict flags are inherently structured; a JSON schema guarantees a renderable, complete object and eliminates parsing fragility.
- **Tradeoff:** structured output precludes native Citations in this call (§4.5) — hence Step B. Accepted deliberately: structure now, citation-proof next.

### 7.2 Step B — citation validation (the DR-10 pass, non-negotiable)

- **Decision:** for each obligation, verify that its `statement`+`rationale` are actually **entailed by the text of its `supporting_chunk_ids`** — via the **Citations API** (pass claim + cited parent as a citation-enabled document; a returned citation span = supported) or a strict Haiku entailment check. Claims that fail are **dropped or flagged, never shown as confident cited statements** (PRD DR-10). These checks are independent and run **in parallel**.
- **Why:** this is what actually delivers groundedness ≥95%. Step A is strong but not infallible; Step B is the mechanical backstop that makes "every substantive claim is supported" true rather than probable. It's also the enforcement point for DR-11 (no parametric knowledge): a claim with no supporting chunk cannot pass, so out-of-corpus assertions are filtered here even if the model produced them.
- **Tradeoff:** an extra model pass adds latency and cost. Mitigate: run on a cheap model, in parallel per-obligation, and only on the claims (short). It gates *display*, so it must finish before a card is shown — factor it into the per-card stream timing, not the first-tier target.

### 7.3 Refusal, "no obligations", conflict, applicability — explicit outputs

- **Refusal (PRD §8.4):** if retrieval returns nothing that clears a relevance threshold, or a follow-up falls outside the corpus, the pipeline emits a **refusal card** directly — generation is not even attempted for out-of-corpus follow-ups. This is a routing decision, not a model mood.
- **No clear obligations (PRD §6.2):** if retrieval is thin but on-topic and Step A yields nothing that survives validation, emit the honest empty state — never a fabricated list.
- **Conflict (PRD §6.1 Step 6, §9):** two mechanisms — a small **curated table of known cross-framework tensions** (e.g. GDPR data-minimisation vs. EU AI Act Art 10(5) bias-testing data; storage-limitation vs. Art 12/26(6) log retention — the pairs in `evals/` CONF-01..04), plus the model's `conflicts_with` flag. Conflicts are rendered as paired, cited cards with **no resolution** asserted.
- **Applicability label (PRD §8.4):** `Direct` when a retrieved clause plainly matches the system's attributes, `Inferred` via reasonable inference, `Possible` when tangential. Emitted by the model in Step A and sanity-checked against citation strength; shown as a labeled chip, never a percentage.

### 7.4 Priority tiers — resolving the PRD's open ranking question (§15)

The map's three tiers (Applies / Likely relevant / Possibly relevant) are computed in **application code**, not asked of the model, from a transparent formula:

```
tier_score = w1·applicability_strength(Direct=1, Inferred=0.6, Possible=0.3)
           + w2·impact_weight(obligations over automated decisions about people rank higher)
           + w3·retrieval_confidence(reranker score, normalized)
```

- **Decision:** compute tiers deterministically; start with equal-ish weights and **tune `w1,w2,w3` against the golden set** (PRD §15 explicitly leaves this to tuning).
- **Why:** deterministic ranking is inspectable, adjustable, and stable across runs — you can explain why an obligation is in "Applies". Asking the model to also rank adds nondeterminism to something that should be a policy.

---

## 8. Subsystem 4 — Orchestration, streaming & latency

### 8.1 The pipeline as a staged, streamed flow

Meets the PRD §3.3/§13 latency targets (first tier ≤5s, full map ≤20s) by **streaming cards as they clear validation** and doing expensive work in parallel:

```
t0  user submits
    → Haiku: classify+sufficiency+decompose        (~0.5–1s)   [if insufficient → ask & stop]
    → retrieve (dense+keyword+RRF) per subquery     (<1s, parallel)
    → rerank + parent expand                        (~0.2–0.3s)
    → Opus Step A: stream obligations               first obligations resolve, then…
        for each obligation, in parallel:
          → Step B validation (cheap, parallel)
          → on pass: assemble card + tiers + citations → SSE push  ◀── first tier ≤5s
    → gaps/conflicts section streams last
```

- **Decision:** stream the **Applies** tier first; lower tiers, gaps, and conflicts follow. Progressive loading names the current stage ("Checking privacy obligations…") per PRD §9.
- **Tradeoff:** streaming complicates the server (partial state, ordering) but is the only way to hit a 5s first-tier target while doing multi-framework synthesis. The full map's 20s budget absorbs the parallel validation.

### 8.2 Prompt caching — the cost/latency multiplier

- **Decision:** cache the **stable prefix** of the Opus generation call: the long system prompt (grounding rules, output schema instructions, refusal/conflict policy) and any fixed few-shot exemplars, via `cache_control` (1-hour TTL, re-warmed). Only the retrieved chunks + user text vary per request and sit after the breakpoint.
- **Why:** the system prompt for the grounded-generation step is large and identical across requests; cached reads cost ~0.1× and cut time-to-first-token. This is the single biggest cost lever.
- **Tradeoff / caution:** caching is a **prefix match** — never interpolate per-request data (timestamps, the user's text, the corpus snapshot date) *into* the cached prefix, or you invalidate it every call. Keep the corpus-as-of date and user input strictly after the last cache breakpoint. Verify with `cache_read_input_tokens > 0`.

### 8.3 Concurrency & timeouts

Retrieval sub-queries, and Step-B validations, run concurrently. All model calls **stream** (the SDK's final-message helper) to avoid HTTP timeouts on the longer Opus generation. A per-stage timeout budget protects the 20s target; a stage that overruns degrades gracefully (§15) rather than hanging.

---

## 9. Data model (Postgres)

```
frameworks(id, name, dimension)                         -- 5 rows
corpus_snapshots(id, snapshot_date, status)             -- immutable once promoted
framework_versions(framework_id, snapshot_id, version_label, source_url)

parents(id, snapshot_id, framework_id, hierarchy_path, citation_label,
        text, source_url, page_from, page_to)
chunks(id, parent_id, snapshot_id, framework_id, hierarchy_path, citation_label,
       text, embedding vector(D), embedding_model_id, char_from, char_to, tsv tsvector)
        -- HNSW index on embedding; GIN index on tsv; btree on framework_id, snapshot_id

conflicts(id, snapshot_id, chunk_id_a, chunk_id_b, note)  -- curated known tensions

eval_results(run_id, run_date, metric, target, value, judge_prompt_version, snapshot_id)
analytics_events(session_id, event_type, ts, payload)     -- see §13; no user descriptions stored
```

- **Decision:** everything keyed by `snapshot_id`; retrieval always filters to the active snapshot. A corpus refresh writes a new snapshot and flips the active pointer atomically.
- **Why:** immutable snapshots make every answer reproducible and let you roll back a bad ingest instantly. The `eval_results` table is what the in-product evaluation page reads (PRD §8.8) — no separate store.

---

## 10. Session & state

- **Decision:** **stateless server, single session, nothing persisted about the user.** The conversation (description, map, follow-ups) lives in the request/response and client memory for the session; the server retains no user descriptions beyond the request (PRD §13). Only anonymous analytics counters (§13) and the eval/corpus tables persist.
- **Why:** it's a PRD requirement and a privacy guarantee (principle #7), and it removes an entire class of state-management and data-retention concerns from the MVP.
- **Tradeoff:** no saved sessions/history (explicitly out of scope, PRD §4.2). Phase 2 can add persistence behind auth; the stateless core doesn't preclude it.

---

## 11. Cost & latency budget

Order-of-magnitude, per obligation-map request (confirm prices at build):

| Stage | Model | Rough tokens | Note |
|---|---|---|---|
| Classify+sufficiency+decompose | Haiku 4.5 | ~1–2k in / ~0.3k out | negligible cost |
| Embeddings (query subqueries) | Voyage | ~a few hundred | negligible |
| Rerank | reranker | — | negligible |
| **Grounded generation (map)** | Opus 4.8 | ~8–20k in (retrieved parents + cached system) / ~2–4k out | **dominant cost; mostly cache-read after warm** |
| Citation validation | Haiku 4.5 | ~1–2k per obligation, parallel | small, scales with #obligations |

- **Levers:** (1) prompt-cache the Opus system prefix (~0.1× reads) — biggest saver; (2) route classify/validate to Haiku; (3) cap retrieved parents (rerank keeps only the best N, so generation input stays bounded); (4) use **Sonnet 5** for follow-ups if volume grows. 
- **Latency:** first tier ≤5s is achievable because the only things before the first card are one Haiku call + retrieval + the start of the Opus stream. The full map ≤20s absorbs parallel validation of lower tiers.
- **Tradeoff:** the map step is deliberately the expensive one — that's where the value is. Don't optimize it by downgrading the model; optimize it with caching and bounded retrieval.

---

## 12. Evaluation integration (wires to `evals/`)

The eval package already exists (`evals/golden_set.jsonl`, `judge_prompts.md`, `run_eval.mjs`, `EVAL_STRATEGY.md`). The system integrates it as follows:

- **Adapter:** `run_eval.mjs`'s `callProduct()` points at the same server pipeline endpoint used by the UI; `callJudge()` points at a judge model. The harness sends each golden question through the *real* retrieval+generation+validation path — so evals measure the system, not a mock.
- **Batch API for cost:** run the golden set through the **Message Batches API** (50% cheaper, async) for the judge calls and any offline map generation — evals are not latency-sensitive.
- **CI gate (PRD §11.3):** on any change to ingest/retrieval/prompts/corpus, CI runs the harness; a build that regresses below target on groundedness (≥95%), citation accuracy (≥90%), or correct-refusal (≥90%) fails and does not ship.
- **In-product report (PRD §8.8):** the harness writes rows to `eval_results` (metric, target, value, run_date, snapshot_id, judge_prompt_version); the evaluation page reads that table. The numbers shown to users are the last CI run's, tied to the snapshot they're browsing.
- **Retrieval-hit-rate** is measured here too, using each golden item's `expected_citations` as ground truth against the top-k retrieved set — the diagnostic that tells you whether a groundedness dip is a retrieval problem or a generation problem.

---

## 13. Observability & instrumentation (PRD §14)

- **Product analytics (anonymous, no descriptions stored):** map-completion rate, clarifying-question rate, citation click-through, follow-up rate, refusal-encounter rate, errors by state, time-to-first-obligation. These populate the PRD §3.3/§14 metrics and validate the design guidelines' UX bets.
- **Pipeline tracing:** per request, log stage timings, retrieval-hit info (which chunks, reranker scores), #obligations, #validation-drops, and the snapshot_id — enough to debug a bad answer without storing the user's text (log chunk IDs and scores, not the description).
- **Contact affordance (PRD §14):** a single unobtrusive way for a viewer to reach the maker — one event, one endpoint.

---

## 14. Security, privacy & abuse

- **Keys server-side only.** The browser never sees a model/DB key; all model calls go through the server/BFF.
- **Prompt-injection posture:** retrieved corpus text is trusted (it's our vetted snapshot), but **user descriptions are untrusted input** — the generation prompt treats the user text as data to be mapped, never as instructions, and the grounding fence (cite-only-provided-chunks + validation) means an injection can't make the system fabricate a citation or answer out-of-corpus. There are no side-effectful tools in the pipeline, which removes the highest-risk injection surface entirely.
- **Privacy (PRD §13):** descriptions aren't required to contain real personal data, aren't persisted, and aren't logged verbatim. The UI (per design guidelines §8) shouldn't coax users into pasting sensitive real data.
- **Rate limiting / cost protection:** per-session and per-IP throttles on the expensive generation endpoint to bound cost and abuse.

## 15. Failure modes & fallbacks

The PRD is absolute that **a failure never yields a fabricated partial answer shown as authoritative** (§9, §13, NFR). Concretely:

| Failure | Behavior |
|---|---|
| Retrieval returns nothing on-topic | Honest empty state ("Nothing in the current corpus clearly applies…"), offer to rephrase/broaden — never an invented list. |
| Generation (Step A) errors or times out | Non-alarming error with retry; no partial map rendered as final. |
| Some obligations fail validation (Step B) | Those are dropped/flagged; the rest render. If *all* fail, fall through to the empty state. |
| Reranker/embedder outage | Degrade to the available retrieval mode (keyword-only) and surface a low-confidence banner; if retrieval can't run, error+retry, no fabrication. |
| Out-of-corpus follow-up | Refusal card (routed, not generated). |
| Low overall confidence | Map renders with the "treat as a starting point for review" banner (PRD §8.4). |

Every path resolves to one of: a grounded answer, an honest gap, a refusal, or a retry — never a confident guess.

## 16. End-to-end trace (the hero flow)

> *"We score loan applicants with an ML model, using personal financial data, for EU customers."*

1. **Understanding (Haiku):** classified `system_description`; sufficient (function/data/decision/region all present) → no clarifying question; decomposed into 5 sub-queries (privacy, AI-reg, AI-risk, security, secure-dev).
2. **Retrieve:** dense+keyword per sub-query → RRF → candidates including GDPR Art 22/35/6, EU AI Act Annex III(5)(b)/Art 9/10/13/14/15, NIST AI RMF §3.7, CSF `PR.DS`, etc.
3. **Rerank + expand:** top clauses reranked against the full description; survivors expanded to parent articles/sections with metadata.
4. **Generate (Opus, structured):** restated understanding ("An ML-based credit-scoring feature… automated decisions about individuals… EU users"); obligations each citing specific chunk IDs; `Annex III(5)(b)` → Direct/high; `Art 22` → Direct/high; gaps + a conflict flag (minimisation vs. bias-testing data).
5. **Validate (parallel, Haiku/Citations):** each claim checked against its cited parent; any unsupported claim dropped. No compliance verdict present (design guardrail).
6. **Assemble & stream:** tiers computed (Applies: credit-scoring-is-high-risk, Art 22, DPIA…), citation chips + source-viewer payloads built from chunk metadata, "Decision support, not legal advice" + "Corpus as of [date]" attached; **Applies** tier streamed first (≤5s), then lower tiers, gaps, and the conflict pair.
7. **Drill-in:** clicking a citation opens the source viewer at the exact paragraph (from metadata + char offsets); clicking an obligation opens a scoped follow-up that re-enters the same pipeline under the same grounding rules.

## 17. Build sequence (de-risk in this order)

1. **Ingestion + data model for ONE framework (GDPR)** end-to-end, with the validation gate. Prove clean hierarchy and citations before scaling to five.
2. **Retrieval** (hybrid + rerank + parent expansion) measured by retrieval-hit-rate on the GDPR subset of the golden set.
3. **Grounded generation + validation** (Steps A/B) for GDPR — hit groundedness/citation targets on that subset. This is the riskiest quality bar; prove it early.
4. **Add the other four frameworks** through the same pipeline; light up cross-framework synthesis and the conflict table.
5. **Streaming, tiers, source viewer, refusal/conflict/clarify states** — the UX per the design guidelines.
6. **Eval page + CI gate**; wire `eval_results`.
7. **Instrumentation, rate limits, polish.**

Rationale: the existential risk is "can we actually be grounded and cited at target rates," so §1–§3 of this sequence prove that on one framework before any breadth or UI investment.

## 18. Key risks & open questions

- **Ingestion fidelity of the NIST SSDF** (multi-column tables extract messily). Mitigation: LLM-assisted structuring reviewed and frozen; the validation gate; SSDF anchors in the golden set.
- **Embedding model choice** materially affects retrieval-hit-rate. Mitigation: the `embed()` seam + an A/B against the golden set; pick by measurement, not brand.
- **Two-step generation latency** (Step B before display) vs. the 20s budget. Mitigation: parallel, cheap-model validation; first tier isn't gated on lower-tier validation.
- **Priority-tier weights** (PRD §15) — unresolved by design; tune `w1,w2,w3` against the golden set and revisit from user reactions.
- **Conflict coverage** — the curated table is only as complete as we make it; the model flag is the safety net, and new conflicts found in use become new golden items (regression capture).
- **Citations API constraints** (no structured output in the same call; confirm current behavior at build) shape the two-step design; if the API surface changes, the split of "structure vs. proof" may simplify — revisit then.

---

*This design serves the PRD's trust-first thesis: the architecture's job is to make groundedness, honest refusal, and verifiable citation **structural properties of the pipeline**, not behaviors we hope the model exhibits. Every decision above is reversible; if one ever trades away that guarantee for speed or simplicity, the guarantee wins.*
