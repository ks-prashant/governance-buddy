# Grounded Governance — Product Requirements Document

**Status:** MVP specification · **Document owner:** Product · **Audience:** Engineering, design, and evaluation

---

## 1. Summary

Grounded Governance is a research assistant for people who build AI systems and need to understand which governance obligations apply to what they are building. A user describes their system in plain language; the product returns a **prioritized, source-cited map of the obligations** that apply to it, drawn from five authoritative frameworks. Every statement is traceable to a specific paragraph in a primary source. When the corpus does not address a question, the product says so rather than guessing.

The product is a decision-support tool, not a source of legal conclusions. Its core promise is not breadth of coverage but **trustworthiness**: grounded answers, honest uncertainty, and citations a user can verify in one click.

---

## 2. The user and the problem

### 2.1 Primary user

The primary user is a **product manager or engineer responsible for shipping an AI feature** — for example, a feature that scores loan applicants, ranks job candidates, or summarizes customer records. This person is technically capable but is not a lawyer or a compliance specialist. They have been told to "make sure it's compliant" and handed a large volume of regulatory and framework documentation.

We design for this single user in the MVP. Compliance analysts, auditors, and legal professionals are real future users, but designing for all of them at once would produce a product tuned for none of them.

### 2.2 The job to be done

> *Translate a description of the system I am building into a prioritized, cited list of the governance obligations that apply to it — quickly, and without receiving a confident answer that is subtly wrong.*

This is a **mapping and triage** job, not a document-search job. The user does not want a search box over PDFs; they want to know what applies to *their specific system* and where each obligation is written down.

### 2.3 Why this is hard

Governance obligations relevant to a single AI feature are spread across privacy law, AI regulation, AI-risk practice, cybersecurity, and secure-development guidance — hundreds of pages that do not cross-reference each other. Generic search cannot reason across them, and general-purpose assistants tend to produce plausible but unsupported or subtly incorrect answers. In a domain where a user may act on the answer, a wrong answer is worse than no answer.

---

## 3. Goals, non-goals, and success metrics

### 3.1 Goals

1. Let a user describe a system and receive a prioritized, source-cited obligation map in a single interaction.
2. Make every claim verifiable at the paragraph level in one click.
3. Make uncertainty and gaps explicit — the product refuses or flags rather than fabricates.
4. Surface conflicts between frameworks instead of resolving them into a false verdict.
5. Demonstrate measured groundedness and correct-refusal rates visibly inside the product.

### 3.2 Non-goals

- Providing legal advice or a compliance verdict ("you are compliant / non-compliant").
- Comprehensive coverage of all jurisdictions or all frameworks.
- Multi-user accounts, collaboration, or persistent workspaces (MVP is single-session).
- Replacing legal or compliance professionals.

### 3.3 Success metrics

**Product quality (gating — see §11 for methods and targets):**
- Groundedness ≥ 95% of claims supported by cited context.
- Citation accuracy ≥ 90% of citations point to the clause that supports the claim.
- Correct-refusal rate ≥ 90% on out-of-corpus questions.
- Time to first rendered obligation ≤ 5 seconds; full map ≤ 20 seconds.

**Product usage:**
- Obligation-map completion rate (input submitted → map rendered without error).
- Citation click-through rate (share of sessions where a user opens at least one source).
- Follow-up-question rate (share of sessions with at least one follow-up).

---

## 4. Scope

### 4.1 In scope (MVP)

- A single natural-language input that accepts a **system description** or a **direct question**.
- A **clarifying-question step** when the input is too thin to map reliably.
- The **Obligation Map**: a prioritized, grouped, source-cited result.
- A **source viewer** that opens the exact cited paragraph with its hierarchy and version.
- **Uncertainty, refusal, and conflict** handling as first-class states.
- **Follow-up questions** grounded in the same corpus.
- A persistent **corpus version indicator** and point-of-answer **decision-support framing**.
- An in-product **evaluation report** page.

### 4.2 Explicitly out of scope (MVP)

Named here so that adding them requires an explicit decision:

- Side-by-side framework comparison view.
- Hierarchical framework browser / navigator.
- Auto-generated suggested questions and related-topic chips.
- Authentication, saved sessions, export to PDF/Word.
- Any additional frameworks or jurisdictions beyond the five below.

---

## 5. The knowledge corpus

The corpus is five complementary frameworks, chosen so the product can answer questions no single document can:

| Governance dimension | Framework |
|---|---|
| Privacy regulation | GDPR |
| AI regulation | EU AI Act |
| AI risk management | NIST AI Risk Management Framework |
| Cybersecurity governance | NIST Cybersecurity Framework 2.0 |
| Secure software development | NIST Secure Software Development Framework |

The corpus is intentionally narrow. Depth on a small, well-modeled corpus produces higher-quality retrieval and a tractable evaluation set.

**The corpus is a dated snapshot.** These frameworks change over time. Each ingested source carries a framework version and a snapshot date, and these are shown to the user (§8.7). The product never claims to reflect the current state of the law beyond the labeled snapshot.

---

## 6. Core user flow: generating an Obligation Map

This is the hero flow. If it is trustworthy and well-crafted, the product succeeds.

### 6.1 Happy path

**Step 1 — Input.**
The user lands on a single prominent input with two example modes: "Describe your system" and "Ask a question." Three example prompts are shown to avoid a blank-page start (e.g., *"We score loan applicants with an ML model, using personal financial data, for EU customers."*).

**Step 2 — Sufficiency check (clarifying question).**
Before mapping, the system evaluates whether the description contains enough to map reliably — at minimum some signal on: what the system does, what data it uses, whether it makes or informs decisions about people, and where it is deployed. If a critical attribute is missing and its absence would materially change the obligations, the product asks **one** targeted clarifying question and waits. It does not interrogate the user with a form, and it does not silently assume. (This directly prevents confident-but-wrong mapping from thin input.)

**Step 3 — Processing.**
The system decomposes the description into retrieval sub-queries across the five dimensions and retrieves candidate obligations. A progressive loading state names what is happening at a high level ("Checking privacy obligations… AI-risk classification… security controls…").

**Step 4 — Restated understanding.**
The result opens with a short restatement of what the product understood the system to be ("An ML-based credit-scoring feature using personal financial data, making automated decisions about individuals, deployed to EU users"), with an inline **"Not quite? Refine"** affordance. This confirms the grounding of the mapping and lets the user correct a misread before trusting the output.

**Step 5 — Obligation Map.**
Below the restatement, obligations are presented in priority tiers (§8.3), each as a card containing a plain-language obligation, why it applies to *this* system, its citation(s), and an applicability signal.

**Step 6 — Gaps, uncertainty, and conflicts.**
A dedicated section lists what the corpus does *not* clearly address for this system, and any places where frameworks appear to conflict, shown side by side without resolution.

**Step 7 — Drill in.**
Clicking a citation opens the source viewer (§8.5). Clicking an obligation opens a scoped follow-up question box (§8.6).

### 6.2 Alternate and error states

| State | Trigger | Behavior |
|---|---|---|
| Empty input | Submit with no text | Inline prompt to describe a system or ask a question; examples remain visible. |
| Too vague | Description lacks a critical attribute | One clarifying question (Step 2). |
| No clear obligations | Retrieval finds nothing that clearly applies | Honest empty state: "Nothing in the current corpus clearly applies to this description." Never a fabricated list. Offer to broaden or rephrase. |
| Out-of-corpus follow-up | Follow-up outside the five frameworks | Refusal card (§8.4). |
| Retrieval/generation failure | System error | Non-alarming error with retry; no partial fabricated answer is shown. |

---

## 7. Requirements derived from risk

Each product risk is expressed as a hard requirement, not a disclaimer.

| Risk | Requirement |
|---|---|
| A user acts on a wrong compliance answer (**liability**) | The product never states a verdict. Decision-support framing appears at the point of answer, not only in a footer. Conflicts are surfaced, not resolved. Out-of-corpus questions are refused. |
| Frameworks change over time (**staleness**) | Every retrieved unit carries framework version and snapshot date. The UI shows "Corpus as of [date]." No claim asserts current law beyond the snapshot. |
| A grounded RAG demo over PDFs is a commodity (**"so what"**) | The evaluation report is a first-class, in-product page. Refusal behavior is visible and intentional in the primary flow. The hero output is an obligation *map*, not generic chat. |
| A solo build sprawls and never ships (**scope**) | §4.2 is binding. Phase gates in §13 govern additions. |
| Subtly wrong cross-framework synthesis | Restated-understanding confirmation (§6.1 Step 4); clarifying question on thin input; every claim cited; post-generation citation validation (§10.4); applicability labeling; conflict surfacing; adversarial evaluation set (§11). |

---

## 8. Functional requirements

### 8.1 Input handling

- **FR-1.1** A single free-text input accepts both a system description and a direct question.
- **FR-1.2** Three example prompts are shown on an empty state and dismiss on focus.
- **FR-1.3** The system classifies the input as *system description* (→ obligation map) or *direct question* (→ grounded answer). When ambiguous, it defaults to the obligation map and offers to switch.

**Acceptance:** Given a system description, when submitted, then an obligation map is produced. Given a standalone question, when submitted, then a single grounded answer with citations is produced.

### 8.2 Sufficiency check and clarification

- **FR-2.1** Before mapping, the system determines whether the description supplies enough to map reliably (function of the system, data used, decision impact on people, deployment region).
- **FR-2.2** If a critical attribute is missing and would change the obligations, the product asks exactly one targeted clarifying question and pauses.
- **FR-2.3** The product never invents missing attributes silently.

**Acceptance:** Given "We built a chatbot," when submitted, then the product asks one clarifying question rather than producing a map. Given a description with all critical attributes, when submitted, then no clarifying question is asked.

### 8.3 Obligation Map

- **FR-3.1** Obligations are grouped into three priority tiers:
  - **Applies — act on these** (directly applicable, high impact)
  - **Likely relevant — review**
  - **Possibly relevant**
- **FR-3.2** Priority is derived from applicability strength (§8.4), the impact of the obligation (e.g., obligations governing automated decisions about individuals rank higher), and retrieval confidence.
- **FR-3.3** Each obligation card contains: a plain-language obligation statement; a "why this applies to your system" rationale that references the user's described attributes; one or more citations; and an **applicability label** (Direct / Inferred / Possible).
- **FR-3.4** Every substantive statement in a card is backed by at least one citation. Uncited substantive claims are a defect.

**Acceptance:** Given a rendered map, when any obligation card is inspected, then it shows a rationale tied to the user's system and at least one clickable citation.

### 8.4 Uncertainty, refusal, and applicability

- **FR-4.1** The **applicability label** is a three-level signal:
  - **Direct** — stated in a retrieved clause that clearly matches the system's attributes.
  - **Inferred** — applies via reasonable inference from retrieved clauses.
  - **Possible** — tangentially related; flagged for user review.
- **FR-4.2** A follow-up question whose answer is not supported by retrieved corpus content returns a **refusal card**: a plain statement that the corpus does not address it, without a fabricated answer, and with a suggestion to rephrase or consult a professional.
- **FR-4.3** Low overall retrieval confidence on a mapping surfaces a banner recommending the map be treated as a starting point for review.

**Acceptance:** Given a question about a framework not in the corpus, when submitted, then a refusal card is shown and no substantive answer is fabricated.

### 8.5 Source viewer

- **FR-5.1** Clicking a citation opens a panel showing the exact source paragraph with it highlighted in surrounding context.
- **FR-5.2** The panel shows the full hierarchy path (framework → part/chapter → article/section → paragraph), the framework version, and the snapshot date.
- **FR-5.3** The panel links to the official published source where one exists.

**Acceptance:** Given any citation, when clicked, then the exact cited paragraph is shown highlighted with its hierarchy and version metadata.

### 8.6 Follow-up questions

- **FR-6.1** From any obligation, the user can ask a follow-up scoped to that obligation.
- **FR-6.2** A general follow-up box is available for questions across the whole result.
- **FR-6.3** Follow-up answers obey the same grounding, citation, and refusal rules as the map.

### 8.7 Corpus versioning and framing

- **FR-7.1** A persistent, unobtrusive indicator shows "Corpus as of [date]" with a hover listing framework versions.
- **FR-7.2** A concise "Decision support, not legal advice" line appears with every generated result, not only in the page footer.

### 8.8 In-product evaluation report

- **FR-8.1** A dedicated page presents the current evaluation results: groundedness, citation accuracy, correct-refusal rate, and retrieval hit rate, each with its target and latest measured value, and the date the evaluation was run.
- **FR-8.2** The page explains the evaluation method in plain language and links to (or shows) representative example questions.

**Acceptance:** Given the evaluation page, when viewed, then each metric is shown with its target, latest value, and run date.

---

## 9. Interaction and UX detail

- **Loading:** progressive, informative loading for the map ("Checking privacy obligations…"), streaming obligation cards as they resolve so the first tier appears within the §3.3 latency target.
- **Empty states:** every state that can be empty (input, no-obligations, no-results follow-up) has an explicit, honest message and a next action. No blank screens, no fabricated filler.
- **Error states:** errors are non-alarming, offer retry, and never render a partial fabricated answer.
- **Confidence display:** applicability is shown as a labeled signal (Direct / Inferred / Possible), never as a false-precision percentage.
- **Conflict display:** conflicting obligations are shown as paired cards under a "These frameworks pull in different directions" heading, each fully cited, with no resolution asserted.
- **Responsiveness and accessibility:** the product is usable on desktop and mobile widths; interactive elements are keyboard-navigable; source highlighting has sufficient contrast.

---

## 10. Data, retrieval, and generation

This section specifies behavior and structure, not implementation code. A reference stack is suggested in §12.

### 10.1 Corpus ingestion and structure

- **DR-1** Each framework is parsed into its natural hierarchy (framework → part/chapter → article/section → paragraph).
- **DR-2** Content is stored using **parent–child chunking**: retrieval operates over small, semantically coherent child chunks; the surrounding parent unit is supplied to the generation step for context.
- **DR-3** Each chunk carries metadata: framework id, framework version, snapshot date, full hierarchy path, a human-readable citation label, and a source URL/anchor.

### 10.2 Query understanding

- **DR-4** A system description is decomposed into sub-queries spanning the five dimensions so that cross-framework coverage is produced by design, not by chance.
- **DR-5** A direct question is expanded/rewritten to improve recall before retrieval.

### 10.3 Retrieval

- **DR-6** Retrieval is **hybrid** (dense semantic + keyword) over child chunks.
- **DR-7** Metadata filtering restricts retrieval when the user scopes a question to specific frameworks.
- **DR-8** Retrieved candidates are **reranked**; the top results are expanded to their parent context before generation.

### 10.4 Generation and grounding enforcement

- **DR-9** Generation is instructed to: cite every substantive claim to supplied context; refuse when support is absent; label applicability; and surface conflicts rather than resolve them.
- **DR-10** A post-generation **citation-validation** pass checks that each cited claim is actually supported by the retrieved context it cites. Claims that fail validation are dropped or flagged; they are never shown as confident, cited statements.
- **DR-11** The generation step is never permitted to answer from parametric/model knowledge outside the retrieved corpus for substantive governance claims.

---

## 11. Evaluation plan

The evaluation is a core deliverable, not an afterthought, and its results are shown in the product (§8.8).

### 11.1 Golden question set

- 50–100 questions with human-verified expected answers, weighted toward hard cases:
  - **Cross-framework synthesis** — questions whose correct answer draws on more than one framework.
  - **Out-of-corpus** — questions that should be refused.
  - **Adversarial** — prompts designed to induce a confident, unsupported answer.
  - **Direct-lookup** — straightforward single-source questions (baseline).

### 11.2 Metrics and targets

| Metric | Definition | Target |
|---|---|---|
| Groundedness | Share of substantive claims supported by cited context | ≥ 95% |
| Citation accuracy | Share of citations that point to the supporting clause | ≥ 90% |
| Correct-refusal rate | Share of out-of-corpus questions correctly declined | ≥ 90% |
| Retrieval hit rate | Share of questions where the supporting chunk appears in the top-k | Tracked and reported |

### 11.3 Process

- The evaluation runs as a repeatable job (in continuous integration where possible) and its latest results populate the in-product evaluation page.
- A build that regresses below target on groundedness, citation accuracy, or correct-refusal is treated as failing.

---

## 12. Reference architecture (suggested, non-binding)

A concrete stack that satisfies the requirements above and is buildable by a small team:

- **Application / UI:** a web app built with a rapid full-stack builder.
- **Storage and retrieval:** a Postgres database with vector search for embeddings plus keyword indexing, holding chunks and the metadata in §10.1.
- **Embeddings and generation:** an LLM API for embeddings, query decomposition, and grounded generation.
- **Ingestion pipeline:** a scripted pipeline (parse → chunk → embed → load with metadata) runnable on demand for corpus refreshes.
- **Evaluation harness:** a scripted job that runs the golden set and writes results consumed by the evaluation page.

Implementation choices may change as long as every functional and grounding requirement is met.

---

## 13. Non-functional requirements

- **Performance:** first obligation tier rendered ≤ 5s; complete map ≤ 20s; progressive streaming permitted to meet the first-tier target.
- **Reliability:** a failure in generation never results in a fabricated partial answer being displayed as authoritative.
- **Transparency:** the model and corpus snapshot behind an answer are discoverable by the user.
- **Privacy:** system descriptions entered by users are not required to contain real personal data; the product does not store descriptions beyond the session in the MVP.

---

## 14. Instrumentation

Minimal analytics tied to product quality and to whether the product achieves its purpose:

- Map completion rate; clarifying-question rate; citation click-through; follow-up rate; refusal-encounter rate.
- Errors by state.
- A single, unobtrusive way for an interested viewer to start a conversation with the maker (contact affordance), so the product can fulfill its purpose of generating inbound interest.

---

## 15. Open questions and assumptions

- **Assumption:** free-text input with a single clarifying question yields better mapping quality than a structured intake form for this user; validate during build and revisit if clarification loops become frequent.
- **Open:** the exact priority-ranking weighting between applicability strength, obligation impact, and retrieval confidence should be tuned against the golden set.
- **Open:** whether conflicts warrant a dedicated section or should live inline within affected obligation cards; decide from early user reactions.

---

## 16. Phasing

- **Phase 1 (this document):** the single flow — input, sufficiency check, obligation map, source viewer, uncertainty/refusal/conflict handling, corpus versioning, and the evaluation page.
- **Phase 2:** side-by-side comparison view, framework navigator, suggested questions, saved sessions.
- **Phase 3 (only with demonstrated demand):** additional corpora, multi-user, and extension of the same architecture to adjacent knowledge domains.
