-- Grounded Governance — initial data model.
create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists frameworks (
  id text primary key,
  name text not null,
  dimension text not null check (
    dimension in ('privacy', 'ai_regulation', 'ai_risk', 'cybersecurity', 'secure_development')
  )
);

create table if not exists corpus_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  status text not null default 'building' check (status in ('building', 'validating', 'active', 'archived')),
  created_at timestamptz not null default now()
);

create unique index if not exists one_active_snapshot_idx
  on corpus_snapshots ((true)) where status = 'active';

create table if not exists framework_versions (
  framework_id text not null references frameworks(id),
  snapshot_id uuid not null references corpus_snapshots(id),
  version_label text not null,
  source_url text,
  primary key (framework_id, snapshot_id)
);

create table if not exists parents (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references corpus_snapshots(id),
  framework_id text not null references frameworks(id),
  hierarchy_path text[] not null,
  citation_label text not null,
  text text not null,
  source_url text,
  page_from int,
  page_to int
);

create index if not exists parents_snapshot_framework_idx
  on parents (snapshot_id, framework_id);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references parents(id),
  snapshot_id uuid not null references corpus_snapshots(id),
  framework_id text not null references frameworks(id),
  hierarchy_path text[] not null,
  citation_label text not null,
  text text not null,
  embedding vector(1024),
  embedding_model_id text,
  char_from int,
  char_to int,
  tsv tsvector generated always as (to_tsvector('english', text)) stored
);

create index if not exists chunks_snapshot_framework_idx
  on chunks (snapshot_id, framework_id);

create index if not exists chunks_embedding_hnsw_idx
  on chunks using hnsw (embedding vector_cosine_ops);

create index if not exists chunks_tsv_gin_idx
  on chunks using gin (tsv);

create unique index if not exists chunks_citation_label_unique_idx
  on chunks (snapshot_id, citation_label);

create table if not exists conflicts (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references corpus_snapshots(id),
  chunk_id_a uuid not null references chunks(id),
  chunk_id_b uuid not null references chunks(id),
  note text not null
);

create index if not exists conflicts_snapshot_idx on conflicts (snapshot_id);

create table if not exists eval_results (
  run_id uuid primary key default gen_random_uuid(),
  run_date timestamptz not null default now(),
  metric text not null,
  target numeric,
  value numeric not null,
  judge_prompt_version text,
  snapshot_id uuid references corpus_snapshots(id)
);

create index if not exists eval_results_run_date_idx on eval_results (run_date desc);

create table if not exists analytics_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  event_type text not null,
  ts timestamptz not null default now(),
  payload jsonb
);

create index if not exists analytics_events_ts_idx on analytics_events (ts desc);

insert into frameworks (id, name, dimension) values
  ('gdpr', 'GDPR', 'privacy'),
  ('eu_ai_act', 'EU AI Act', 'ai_regulation'),
  ('nist_ai_rmf', 'NIST AI RMF', 'ai_risk'),
  ('nist_csf', 'NIST CSF 2.0', 'cybersecurity'),
  ('nist_ssdf', 'NIST SSDF', 'secure_development')
on conflict (id) do nothing;