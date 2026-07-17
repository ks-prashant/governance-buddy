-- Grounded Governance — initial data model.
-- Source of record: architecture/SYSTEM_DESIGN.md §9, §5 (ingestion), §7 (generation).
--
-- Everything is keyed by snapshot_id (system design §9 decision). Retrieval always
-- filters to the active snapshot; a corpus refresh writes a new snapshot and flips
-- the active pointer atomically. Snapshots are immutable once promoted.

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ── Frameworks (5 rows, seeded below) ──────────────────────────────────────────
create table if not exists frameworks (
  id text primary key,                    -- stable slug, e.g. 'gdpr', 'eu_ai_act'
  name text not null,                     -- display name, e.g. 'GDPR'
  dimension text not null check (
    dimension in ('privacy', 'ai_regulation', 'ai_risk', 'cybersecurity', 'secure_development')
  )
);

-- ── Corpus snapshots — immutable once promoted (system design §5.5, §9) ───────
create table if not exists corpus_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  status text not null default 'building' check (status in ('building', 'validating', 'active', 'archived')),
  created_at timestamptz not null default now()
);

-- Only one snapshot may be 'active' at a time.
create unique index if not exists one_active_snapshot_idx
  on corpus_snapshots ((true)) where status = 'active';

create table if not exists framework_versions (
  framework_id text not null references frameworks(id),
  snapshot_id uuid not null references corpus_snapshots(id),
  version_label text not null,            -- e.g. 'OJ L 119, 4.5.2016' or 'AI RMF 1.0 (Jan 2023)'
  source_url text,
  primary key (framework_id, snapshot_id)
);

-- ── Parents — article/section-level units; generation context + source-viewer unit
-- (system design §5.3: retrieve over children, generate over parents) ─────────
create table if not exists parents (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references corpus_snapshots(id),
  framework_id text not null references frameworks(id),
  hierarchy_path text[] not null,          -- e.g. {'GDPR','Chapter III','Article 22'}
  citation_label text not null,            -- human-readable, e.g. 'GDPR Art. 22'
  text text not null,                      -- full parent text, verbatim from source
  source_url text,                         -- link to the official published source (FR-5.3)
  page_from int,
  page_to int
);

create index if not exists parents_snapshot_framework_idx
  on parents (snapshot_id, framework_id);

-- ── Chunks — the smallest semantically coherent unit; embedded and retrieved
-- (system design §5.3, §5.4) ────────────────────────────────────────────────────
-- [verify at build] vector(1024) matches EMBEDDING.dim in src/server/pipeline/config.ts
-- (voyage-3-large placeholder). A model/dimension change requires a clean re-index —
-- do not silently alter this column; ship it as a new migration tied to a new snapshot.
create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references parents(id),
  snapshot_id uuid not null references corpus_snapshots(id),   -- denormalized for filtering
  framework_id text not null references frameworks(id),        -- denormalized for filtering
  hierarchy_path text[] not null,
  citation_label text not null,            -- e.g. 'GDPR Art. 22(1)'
  text text not null,                      -- child clause text, verbatim
  embedding vector(1024),
  embedding_model_id text,                 -- e.g. 'voyage-3-large' — carried per-row (DR-3)
  char_from int,
  char_to int,
  tsv tsvector generated always as (to_tsvector('english', text)) stored
);

create index if not exists chunks_snapshot_framework_idx
  on chunks (snapshot_id, framework_id);

-- HNSW for dense retrieval (system design §4.2). Cosine distance matches Voyage's
-- recommended similarity metric.
create index if not exists chunks_embedding_hnsw_idx
  on chunks using hnsw (embedding vector_cosine_ops);

-- GIN for keyword/BM25-style retrieval (system design §4.2, DR-6).
create index if not exists chunks_tsv_gin_idx
  on chunks using gin (tsv);

-- Citation labels must be unique and well-formed per snapshot (ingestion validate
-- gate, system design §5.5) — enforced here so a bad ingest cannot silently promote.
create unique index if not exists chunks_citation_label_unique_idx
  on chunks (snapshot_id, citation_label);

-- ── Conflicts — curated known cross-framework tensions (system design §7.3) ────
create table if not exists conflicts (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references corpus_snapshots(id),
  chunk_id_a uuid not null references chunks(id),
  chunk_id_b uuid not null references chunks(id),
  note text not null                       -- plain-language description of the tension
);

create index if not exists conflicts_snapshot_idx on conflicts (snapshot_id);

-- ── Eval results — feeds the in-product evaluation page (PRD §8.8) ─────────────
create table if not exists eval_results (
  run_id uuid primary key default gen_random_uuid(),
  run_date timestamptz not null default now(),
  metric text not null,                    -- 'groundedness' | 'citation_accuracy' | 'correct_refusal' | 'retrieval_hit_rate' | ...
  target numeric,
  value numeric not null,
  judge_prompt_version text,
  snapshot_id uuid references corpus_snapshots(id)
);

create index if not exists eval_results_run_date_idx on eval_results (run_date desc);

-- ── Analytics — anonymous counters only; never the user's system description
-- (PRD §13, §14; system design §13) ─────────────────────────────────────────────
create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,                -- client-generated, not tied to identity
  event_type text not null,                -- 'map_completed' | 'clarifying_question' | 'citation_click' | 'follow_up' | 'refusal' | 'error' | ...
  ts timestamptz not null default now(),
  payload jsonb                            -- chunk ids, scores, snapshot_id, timings — never raw user text
);

create index if not exists analytics_events_ts_idx on analytics_events (ts desc);

-- ── Seed the five frameworks (PRD §5) ──────────────────────────────────────────
insert into frameworks (id, name, dimension) values
  ('gdpr', 'GDPR', 'privacy'),
  ('eu_ai_act', 'EU AI Act', 'ai_regulation'),
  ('nist_ai_rmf', 'NIST AI RMF', 'ai_risk'),
  ('nist_csf', 'NIST CSF 2.0', 'cybersecurity'),
  ('nist_ssdf', 'NIST SSDF', 'secure_development')
on conflict (id) do nothing;
