# Grounded Governance — Brand, Marketing, UX & UI Guidelines

**Purpose:** the single reference for how the product looks, sounds, and behaves. It exists to keep every surface — landing page, hero flow, microcopy, the eval report — pulling in one direction. Companion to the PRD (`grounded-governance-prd.md`) and the eval package (`evals/`).

**Status:** foundational spec · **Applies to:** UI, copy, marketing, and the reference build (rapid full-stack builder per PRD §12). Concrete values (colors, type) are **starting directions**, not locked assets — but the *rules* around them are binding.

---

## 0. The one idea

Everything in this document descends from a single sentence:

> **The product's only real asset is trust, so every brand, design, and UX decision must make the answer more verifiable and the product's honesty more visible — and must actively resist the aesthetics of overconfidence.**

If a choice makes the product look slicker but feel less honest, it is wrong. A governance tool that looks confident and is subtly wrong is worse than useless (PRD §2.3). We are building the opposite: a calm instrument that shows its work and admits its limits. When in doubt, re-read the sentence above and pick the option that serves it.

---

## 1. Brand foundation

### 1.1 Positioning statement

For the **product manager or engineer told to "make it compliant"** (PRD §2.1), Grounded Governance is a **research assistant that maps their specific AI system to the governance obligations that apply to it** — with every statement traceable to a primary source in one click, honest about what it doesn't know, and never posing as legal advice. Unlike generic search or general-purpose chatbots, it produces a **prioritized, cited obligation map**, not plausible prose.

### 1.2 Brand personality

Think of the brand as **a senior colleague who happens to have read all the frameworks** — precise, calm, generous with context, and completely unbothered about saying "that's outside what I can support." Not a lawyer, not a salesperson, not a chatbot.

| The brand **is** | The brand **is not** |
|---|---|
| Precise, exacting | Pedantic, cold |
| Calm, measured | Alarmist, urgent, fear-driven |
| Honest about limits | Falsely confident, hedge-everything wishy-washy |
| Quietly authoritative | Intimidating, jargon-flexing |
| Respectful of a smart non-lawyer | Condescending or dumbed-down |
| Document-forward, source-anchored | Flashy, dashboard-gamified |
| Restrained | Feature-maximalist |

**Litmus test:** if a screen would look at home in a fintech growth-hack funnel or a "AVOID €35M FINES!" compliance ad, it is off-brand.

### 1.3 Design principles (the eight)

These are the tie-breakers. Memorize them; cite them in design reviews.

1. **The source is the hero.** Every substantive claim is one click from the exact primary text. The citation is not a footnote — it is the point.
2. **Show the work, not just the answer.** Reveal *why* an obligation applies to *this* system, and where it's written down. Reasoning visible beats conclusions asserted.
3. **Honesty over completeness.** A clearly stated gap beats a confidently filled one. An honest empty state is a feature, not a failure.
4. **Confidence is labeled, never implied.** Applicability is a named signal (Direct / Inferred / Possible), never a false-precision percentage, never visual swagger.
5. **Calm, not alarmed.** No fear-based design, no manufactured urgency, no red-everywhere. Governance is serious; the UI is steady.
6. **Map, don't chat.** The hero output is a structured, scannable obligation *map*. Conversation is a secondary affordance, not the main event.
7. **Restraint is a feature.** Narrow scope, quiet surfaces, few components. Every addition must earn its place (PRD §4.2 is binding).
8. **Decision support, never a verdict.** The product informs a decision; it never renders one. "Compliant / non-compliant" is not in our vocabulary or our UI.

### 1.4 Aesthetic north star

**Editorial, document-forward, instrument-like** — closer to a well-typeset legal/scientific reference or a serious reading tool than to a typical SaaS dashboard. Paper-like calm surfaces, generous whitespace, text as the primary material, color used almost exclusively to carry meaning. The feeling to aim for: *"this thing is careful."*

---

## 2. Voice & tone

### 2.1 Voice (constant)

- **Plain over legalese.** Write for a capable non-lawyer (PRD §2.1). Explain obligations in plain language first; the precise legal text lives in the source viewer.
- **Specific over generic.** Reference the user's described system ("your credit-scoring model", "because you make automated decisions about individuals"). Generic advice is a smell.
- **Direct over hedged.** Say what is known plainly and what is unknown plainly. Avoid both false confidence and reflexive weasel-hedging.
- **Sourced over asserted.** Prefer "GDPR Article 22 gives individuals the right to…" over "you must…". We report what frameworks say; we don't issue commands.
- **Short.** Front-load the point. Cards are scanned, not read.

### 2.2 Tone (shifts by state)

| State | Tone | Notes |
|---|---|---|
| Default answer | Calm, informative | Lead with the obligation, then the why, then the source. |
| Clarifying question | Curious, light, singular | One question, conversational, never a form or interrogation. |
| Low confidence | Transparent, steady | "Treat this as a starting point for review" — not apologetic, not alarmed. |
| Refusal (out of corpus) | Honest, respectful, un-embarrassed | Refusing is doing the job well; the copy should feel intentional, never like an error. |
| Conflict | Even-handed, neutral | Present both sides; assert no winner. |
| Error | Non-alarming, brief, actionable | Offer retry. Never show a partial fabricated answer. |
| Success / completion | Understated | No confetti, no "🎉". The reward is the map itself. |

### 2.3 Microcopy rules

- Name what's happening during loading, honestly ("Checking privacy obligations… AI-risk classification…"), never a fake spinner with a vague "Thinking…".
- Every empty state gets an explicit message **and** a next action (PRD §9). No blank screens.
- Refusals state *what* isn't covered and offer a path (rephrase, or consult a professional) — never a dead end.
- Persistent framing line with every result: **"Decision support, not legal advice"** — at the point of answer, not buried in a footer (PRD §8.7, §7).
- Buttons and labels are verbs and nouns, not cleverness. "Open source", "Refine", "Ask a follow-up".

### 2.4 Lexicon

**Use freely:** grounded · cited · source · traceable · applies to your system · starting point · review · as of [date] · obligation · likely relevant · possibly relevant · the corpus · not addressed.

**Never use** (brand-breaking):
- **Verdict words:** "compliant", "non-compliant", "you're covered", "you're safe", "guarantees", "ensures compliance", "certified".
- **Fear words:** "fines", "penalties", "risk of prosecution" *as a scare tactic* (penalty facts may appear only when a user asks and only as sourced corpus content, never as marketing).
- **Overclaim words:** "comprehensive", "complete", "all obligations", "everything you need", "fully compliant".
- **False-precision:** "92% confident", "high certainty score" — applicability is Direct/Inferred/Possible, full stop.
- **Legal-advice framing:** "we recommend you must", "our legal opinion".

**Reading level:** aim for a smart generalist. Expand or link every acronym on first use. Legal terms of art are allowed but must be immediately glossed in plain language.

---

## 3. Messaging & marketing

### 3.1 Value proposition

> **Describe the AI system you're building. Get a prioritized, source-cited map of the governance obligations that apply to it — grounded in primary sources, honest about the gaps, and verifiable in one click.**

### 3.2 Messaging pillars

Every marketing surface ladders up to exactly these four. Don't invent a fifth.

1. **Grounded** — every claim is backed by a citation to a primary source. No unsupported prose.
2. **Honest** — it tells you when something is outside its sources, and surfaces conflicts instead of papering over them.
3. **Specific to you** — it maps obligations to *your* described system, not a generic checklist.
4. **Verifiable** — one click takes you to the exact paragraph, with version and date.

### 3.3 Tagline directions (directions, not final copy)

Aim: state the differentiator, avoid overclaim. Directions to explore — *"Obligations, mapped to your system — and traceable to the source." / "Grounded answers about AI governance. Nothing you can't verify." / "Know what applies. See where it's written."* Avoid anything with "compliant", "guaranteed", or fear.

### 3.4 The "so what" narrative (the anti-commodity story)

A grounded RAG demo over PDFs is a commodity (PRD §7). Our story is not "we chat with documents"; it's **"we refuse to make things up, and we prove it."** The marketing spine:

1. General assistants sound confident and are sometimes subtly wrong — dangerous in governance.
2. Grounded Governance is built the opposite way: it cites everything, refuses out-of-scope questions, and shows its own measured groundedness.
3. Here's the proof — a live citation-to-source click, a real refusal, and the in-product evaluation report.

**Show, don't tell:** the strongest marketing asset is the product doing the honest thing on camera — a real citation opening its source, and a real out-of-corpus question getting a clean refusal.

### 3.5 Landing page intent (structure, not copy)

Order sections by trust, not by hype:
1. **Hero** — the value prop + a single, obviously-clickable way to try the hero flow. No stock "AI hero" imagery; show the actual product.
2. **Proof of grounding** — a real obligation card with a citation that opens the source viewer. This *is* the pitch.
3. **Proof of honesty** — a refusal card and a conflict pair, shown deliberately.
4. **The four pillars** (§3.2), each in one line.
5. **The evaluation report** — link/preview the measured groundedness, citation accuracy, correct-refusal rates. Credibility through numbers we're willing to publish.
6. **Scope honesty** — plainly state what it covers (five frameworks, dated snapshot) and what it doesn't. Under-promising is on-brand.
7. **One contact affordance** (PRD §14) — unobtrusive, single, respectful. The product exists partly to generate inbound; let quality do the asking.

### 3.6 Marketing do / don't

| Do | Don't |
|---|---|
| Lead with grounding + honesty | Lead with fear of fines |
| Show real product moments | Use abstract "AI brain" visuals |
| State scope limits plainly | Imply comprehensiveness |
| Publish the eval numbers | Hide behind vague "trusted" claims |
| Let the demo be the argument | Overwrite with adjectives |
| Keep one clear CTA | Stack urgency/scarcity CTAs |

---

## 4. Visual identity

### 4.1 Art direction

**"The instrument and the source."** Two visual registers, deliberately paired:
- **The interface** (synthesis, the product's own voice): clean, quiet, sans-serif, spacious.
- **The source** (primary legal/framework text): treated with reverence — serif, document-like, set apart, always clearly "not our words but the source's words."

This split is not decoration; it visually encodes the product's central honesty: *here is what we say, and here is the text it rests on.*

### 4.2 Logo / wordmark direction

- Prefer a **wordmark** over a pictorial mark; this is a text-and-truth product. If a mark is used, evoke *anchoring / citation / a mark of provenance* (e.g., an anchor, a bracket, a pin to a line) — never a generic "AI spark", robot, or brain.
- Must work in one color and at small sizes (it will sit near the persistent corpus indicator).
- Restrained, editorial, timeless over trendy.

### 4.3 Color system

Color is **functional first**. The base is near-neutral "paper"; color almost always means something. Values below are a starting palette — tune freely, but keep the *roles* and the *contrast rules*.

**Neutrals (the canvas):**
- Paper / surface: near-white warm neutral (light) / near-black warm neutral (dark). Aim for a calm, slightly warm base, not stark clinical white/black.
- Ink / primary text: very high contrast against paper (≥ 7:1 for body where feasible).
- Muted text / metadata: secondary contrast (still ≥ 4.5:1).
- Hairline / border: low-contrast lines for structure (the "typeset document" feel).

**Brand accent (sparingly):** one restrained, serious accent (a deep blue/teal or ink-indigo direction) for primary actions, links, and citations. Not a bright startup gradient. One accent, used little.

**Semantic — priority tiers (PRD §8.3):** three levels that read as *priority*, not *danger*.
- **Applies — act on these:** the strongest, most saturated treatment (still calm — a solid, confident accent, not alarm-red).
- **Likely relevant — review:** medium emphasis.
- **Possibly relevant:** low emphasis / muted.

**Semantic — applicability labels (PRD §8.4):** Direct / Inferred / Possible — a distinct, restrained scale (e.g., filled → half → outline treatment) that is **legible without color** (see rule below).

**Semantic — states:**
- Refusal / out-of-corpus: a neutral, honest treatment (muted, not error-red). Refusal is not an error.
- Conflict: a distinct, neutral "attention" hue (amber/ochre direction) signaling *tension*, not *wrong*.
- Error: reserved, used *only* for genuine system errors, and even then non-alarming.

**Binding color rules:**
- **Never encode meaning by color alone.** Every tier, label, and state carries a text label and/or icon/shape. (Accessibility + PRD §9 "labeled signal, never false-precision".)
- **No red for priority.** Red reads as "danger/non-compliant" and we render no verdicts. Reserve red-adjacent tones strictly for true errors, and even then dial them down.
- Meet **WCAG 2.1 AA** contrast minimums everywhere; source-highlight backgrounds must keep highlighted text ≥ 4.5:1 (PRD §9).
- Full light **and** dark support; both are first-class.

### 4.4 Typography

Three roles, each doing a job:

| Role | Typeface direction | Used for |
|---|---|---|
| **Source serif** | A readable, authoritative serif (e.g., a humanist/transitional serif) | Quoted primary-source text in the source viewer and any verbatim framework language. Signals "these are the source's words." |
| **UI sans** | A clean, highly legible humanist sans | All product chrome, obligation statements, rationales, navigation, marketing. |
| **Citation mono** | A monospace | Citation labels, hierarchy paths, version/date metadata (e.g., `GDPR · Art. 22(1)` · `as of 2024-07-12`). Signals precision and machine-verifiability. |

**Rules:**
- One serif, one sans, one mono. No more. (Restraint principle.)
- Establish a modular type scale (suggest ~1.2–1.25 ratio) and use it consistently; don't hand-pick sizes.
- Body/reading text: comfortable measure (~60–75 characters), generous line-height (~1.5). This is a reading tool.
- Obligation statements: slightly larger/heavier than rationale text to create scan hierarchy inside a card.
- Never justify body text; never all-caps long strings (labels only).

### 4.5 Layout, grid & spacing

- **Spacing scale:** a single base unit (recommend 4px) with a consistent scale (4/8/12/16/24/32/48…). No arbitrary spacing.
- **Generous whitespace** is a brand signal of calm and care — don't crowd.
- **Reading-column layout**, not a dense dashboard grid. The map is a prioritized vertical read, streamed tier by tier (PRD §9), not a wall of tiles.
- **Source viewer** gets real estate — it's the payoff moment; a side panel or generous modal, not a cramped tooltip.
- Responsive: fully usable on desktop and mobile widths (PRD §9). On mobile the map stacks; the source viewer becomes a full-height sheet.

### 4.6 Iconography

- Minimal, consistent line icons; one family. Icons *support* labels, never replace them.
- Reserve a distinct, recognizable icon for **"open source / citation"** — it will be the most-clicked affordance and should read unmistakably as "go to the primary text."
- No decorative illustration of "AI." If illustration is used at all, lean toward *documents, anchors, marginalia, provenance* motifs.

### 4.7 Depth, borders & the "paper" metaphor

- Prefer **hairline borders and subtle tonal separation** over heavy drop-shadows. The world is made of typeset paper, not floating Material cards.
- Elevation is used sparingly and only to signal a true layer change (the source viewer coming forward, a menu opening).

### 4.8 Displaying confidence & numbers

- Applicability = **Direct / Inferred / Possible**, shown as a labeled chip. **No percentages, no gauges, no 0–100 "confidence scores"** in the answer surface (PRD §9). False precision is a brand violation.
- The **only** place numbers-as-metrics belong is the **evaluation report page**, where they are the point (measured groundedness, etc.) — and there they must always be shown with target + latest value + run date (PRD §8.8).

---

## 5. Core UX patterns

Component-level guidance for the hero flow (PRD §6, §8). For each: what it must do, and the trust rule that governs it.

### 5.1 The hero input
- One prominent free-text field accepting **either** a system description **or** a direct question (PRD §8.1). Two example modes visible ("Describe your system" / "Ask a question").
- Three example prompts to defeat the blank page (PRD §6.1, §8.1); they dismiss on focus.
- Empty submit → inline, friendly prompt; examples stay visible. Never an error tone for an empty field.

### 5.2 Sufficiency / clarifying question
- When input is too thin to map reliably, ask **exactly one** targeted question and pause (PRD §8.2). One. Not a form, not a stack.
- Frame it as a colleague clarifying, not a gate. Show *why* it's asked if it helps ("To map this I need to know whether it makes decisions about people").
- Never silently invent the missing attribute (PRD §8.2 FR-2.3).

### 5.3 Progressive loading
- Name the steps honestly as they run ("Checking privacy obligations… AI-risk classification… security controls…") (PRD §6.1, §9).
- Stream the first priority tier as soon as it resolves to hit the ≤5s first-tier target (PRD §3.3, §13); don't block on the full map.

### 5.4 Restated understanding
- Open the result with a plain restatement of what the system understood ("An ML-based credit-scoring feature… making automated decisions about individuals… deployed to EU users") with an inline **"Not quite? Refine"** (PRD §6.1 step 4).
- This is a trust checkpoint — let the user correct a misread *before* they rely on the map.

### 5.5 Obligation Map & card anatomy
Each obligation card contains, in this hierarchy (PRD §8.3):
1. **Plain-language obligation statement** (largest, first).
2. **"Why this applies to your system"** — rationale that explicitly references the user's described attributes.
3. **Citation chip(s)** — visually prominent, unmistakably clickable → source viewer.
4. **Applicability label** — Direct / Inferred / Possible chip.
- **Every substantive statement is cited.** An uncited substantive claim is a defect, and should be visually impossible to ship (PRD §8.3 FR-3.4).
- Cards are scannable: obligation readable in ~2 seconds; detail on demand.

### 5.6 Priority tiers
- Three grouped tiers with clear headers (PRD §8.3): **Applies — act on these** · **Likely relevant — review** · **Possibly relevant**.
- Visual weight descends with priority (§4.3). Tiers are labeled in words, never color-only.

### 5.7 Citations — the hero interaction
- Citations must look like the most important, most clickable thing on the card. Use the reserved citation icon + mono label (e.g., `GDPR · Art. 22(1)`).
- Hover/focus affordance makes it obvious a source will open. This single click is the product's core promise made physical — treat it as the primary CTA of the whole app.

### 5.8 Source viewer (the payoff)
- Opens the **exact cited paragraph, highlighted, in its surrounding context** (PRD §8.5).
- Shows the **full hierarchy breadcrumb** (framework → part/chapter → article/section → paragraph), **framework version**, and **snapshot date** (PRD §8.5 FR-5.2).
- Links to the **official published source** where one exists (FR-5.3).
- Typeset in the **source serif** (§4.4) so it reads as primary material, distinct from the product's own voice.
- This is where trust is delivered or lost — give it space, legibility, and reverence.

### 5.9 Refusal card (out of corpus)
- A plain, un-embarrassed statement that the corpus doesn't address the question, with **no fabricated answer**, plus a path forward (rephrase / consult a professional) (PRD §8.4, §6.2).
- Styled as an intentional, first-class state — neutral tone, **not** error-red, not an apology. Refusing well is the product working correctly, and the design should say so.

### 5.10 Conflict display
- Conflicting obligations shown as **paired cards** under a heading like **"These frameworks pull in different directions,"** each fully cited, with **no resolution asserted** (PRD §9, §6.1 step 6).
- Neutral "tension" treatment (§4.3), never a winner/loser visual.

### 5.11 Gaps & uncertainty section
- A dedicated section lists what the corpus does **not** clearly address for this system (PRD §6.1 step 6). Honest, specific, not filler.
- Low overall retrieval confidence → a calm banner recommending the map be treated as a starting point for review (PRD §8.4 FR-4.3). Steady tone, not alarm.

### 5.12 Follow-up questions
- From any obligation, a **scoped** follow-up; plus a general follow-up box for the whole result (PRD §8.6).
- Follow-ups obey the **same** grounding, citation, and refusal rules as the map (FR-6.3). No relaxed standard just because it's "chat."

### 5.13 Corpus versioning & decision-support framing
- Persistent, **unobtrusive** "Corpus as of [date]" indicator with hover listing framework versions (PRD §8.7). Always present, never shouting.
- "Decision support, not legal advice" appears **with every generated result**, at the point of answer (PRD §8.7 FR-7.2) — not only in the footer.

### 5.14 Empty & error states
- Every emptyable state (input, no-obligations, no-results follow-up) has an explicit honest message + next action (PRD §9). "Nothing in the current corpus clearly applies…" is a valid, well-designed outcome — never a fabricated list.
- Errors are non-alarming, offer retry, and **never** render a partial fabricated answer as authoritative (PRD §9, §13).

### 5.15 Evaluation report page (credibility surface)
- A first-class, in-product page (PRD §8.8) — not a hidden admin view. Design it as a **credibility artifact**: each metric with its **target, latest measured value, and run date**, plus a plain-language method explanation and representative example questions.
- This is the one place where numbers and (restrained) data visualization are appropriate and encouraged. Keep it honest and legible; if a metric is below target, show it — the willingness to show it *is* the brand.

---

## 6. Interaction & motion

- **Motion is functional and quiet.** Use it to explain (streaming cards arriving in priority order, the source panel sliding in from the cited card), never to entertain.
- Respect `prefers-reduced-motion`; provide instant, non-animated equivalents.
- No celebratory animation on answer completion — the map is the reward (§2.2).
- Transitions short (≈150–250ms), eased, consistent. Nothing bouncy or playful.
- The citation → source transition should feel like a direct, traceable link (spatial connection between the clicked citation and the opened source), reinforcing "this claim came from *here*."

---

## 7. Accessibility & responsive (non-negotiable)

- **WCAG 2.1 AA** minimum across the product (contrast, focus, semantics).
- **Full keyboard navigability** for all interactive elements, including citations and the source viewer (PRD §9). Visible focus states everywhere.
- **Never rely on color alone** — every tier/label/state has text and/or shape (§4.3).
- Source highlighting keeps highlighted text at sufficient contrast (PRD §9).
- Screen-reader semantics: cards, tiers, and the source viewer use correct roles/landmarks; citations announce as links to a source; applicability labels are announced, not just visually chipped.
- Usable on desktop and mobile widths (PRD §9); touch targets ≥ 44px; source viewer adapts to a full-height sheet on mobile.

---

## 8. Trust & ethics guardrails (anti-dark-pattern)

The brand dies the first time the product misleads. Hard rules:
- **No manufactured urgency, scarcity, or fear.** No countdowns, no "act now," no fine-scare marketing.
- **No fabricated confidence.** No invented certainty scores, no filler when the honest answer is "not addressed."
- **No verdicts, ever** — in UI, copy, or marketing (§1.3 principle 8).
- **No hiding scope or staleness.** Corpus limits and snapshot date are always discoverable (PRD §5, §7).
- **Privacy by default.** System descriptions aren't required to contain real personal data, and aren't stored beyond the session in the MVP (PRD §13). Don't design flows that coax users into pasting sensitive real data; if they might, say they needn't.
- **No engagement-baiting.** Follow-up prompts and the contact affordance are helpful, single, and respectful — not attention traps.

---

## 9. Scope & system governance (keep it from sprawling)

A solo build sprawls and never ships (PRD §7). The design system enforces discipline:
- **Minimal component set.** Reuse before you add. Every new component/pattern needs a real justification against the eight principles.
- **§4.2 of the PRD is binding** — no side-by-side comparison view, framework browser, suggested-question chips, auth, saved sessions, or export in MVP, regardless of how easy the builder makes them.
- **One of each primitive:** one accent, one serif/sans/mono, one spacing scale, one card pattern, one modal/panel pattern.
- Additions are governed by the PRD phase gates (§13/§16). Design debt is scope creep in disguise.

---

## 10. Success measures (brand & UX)

Tie brand/UX health to the product's own instrumentation (PRD §3.3, §14) plus qualitative trust signals:

**Quantitative (already instrumented):**
- **Citation click-through rate** — do users open sources? (Our whole thesis; if low, the citation affordance isn't selling trust.)
- **Map completion rate** — input submitted → map rendered without error.
- **Follow-up rate** — engagement with grounded follow-ups.
- **Refusal-encounter rate** & **clarifying-question rate** — are the honesty states firing as intended, not too often, not never.
- **Time to first rendered obligation** (≤5s) — perceived responsiveness (PRD §3.3).

**Qualitative:**
- Post-interaction sense of trust ("Did this feel trustworthy? Could you verify a claim?").
- Whether users can, unprompted, get from a claim to its source in one try (core-promise usability test).
- Absence of "it told me I was compliant" misunderstandings — a signal the decision-support framing is landing.

---

## 11. Build-time quick reference

**Always**
- [ ] Every substantive claim shows a clickable citation.
- [ ] Applicability shown as Direct/Inferred/Possible label (never %).
- [ ] "Decision support, not legal advice" present at the point of answer.
- [ ] "Corpus as of [date]" indicator visible.
- [ ] Every empty/refusal/error state has an honest message + next action.
- [ ] Meaning never carried by color alone; AA contrast met; keyboard-navigable.
- [ ] Source viewer shows exact paragraph + hierarchy + version + date.
- [ ] First priority tier streams within the latency target.

**Never**
- [ ] No "compliant/non-compliant" or any verdict, anywhere.
- [ ] No fabricated answer, filler, or invented confidence score.
- [ ] No fear/urgency/scarcity in product or marketing.
- [ ] No red-for-priority; red reserved for true errors, dialed down.
- [ ] No percentage/gauge confidence in the answer surface.
- [ ] No extra frameworks, comparison views, or scope beyond PRD §4.1.
- [ ] No celebratory or decorative motion; nothing that entertains over informs.

---

*This document serves the PRD and the eval package. If a guideline here ever conflicts with the product's honesty, honesty wins — and this document is what's wrong. Update it deliberately.*
