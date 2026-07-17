-- Hybrid retrieval RPCs (system design §6.2, build plan §C).
--
-- pgvector's `<=>` distance operator and Postgres FTS aren't expressible through
-- PostgREST's query builder directly — these SQL functions are the standard way to
-- expose them via supabase-js `.rpc()`. Both are scoped to a single snapshot (the
-- caller looks up the active snapshot id) and optionally filtered to one framework
-- (DR-7 — metadata filtering when a question is scoped to a framework).

create or replace function match_chunks_dense(
  query_embedding vector(1024),
  p_snapshot_id uuid,
  p_framework_id text default null,
  match_count int default 20
)
returns table (
  id uuid,
  parent_id uuid,
  framework_id text,
  hierarchy_path text[],
  citation_label text,
  text text,
  similarity float
)
language sql stable as $$
  select c.id, c.parent_id, c.framework_id, c.hierarchy_path, c.citation_label, c.text,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  where c.snapshot_id = p_snapshot_id
    and (p_framework_id is null or c.framework_id = p_framework_id)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_chunks_keyword(
  query_text text,
  p_snapshot_id uuid,
  p_framework_id text default null,
  match_count int default 20
)
returns table (
  id uuid,
  parent_id uuid,
  framework_id text,
  hierarchy_path text[],
  citation_label text,
  text text,
  rank float
)
language sql stable as $$
  select c.id, c.parent_id, c.framework_id, c.hierarchy_path, c.citation_label, c.text,
    ts_rank(c.tsv, websearch_to_tsquery('english', query_text)) as rank
  from chunks c
  where c.snapshot_id = p_snapshot_id
    and (p_framework_id is null or c.framework_id = p_framework_id)
    and c.tsv @@ websearch_to_tsquery('english', query_text)
  order by rank desc
  limit match_count;
$$;
