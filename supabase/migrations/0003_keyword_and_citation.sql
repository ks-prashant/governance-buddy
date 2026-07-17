-- Retrieval fixes (build plan §C hardening).
--
-- (1) Fix keyword search recall. websearch_to_tsquery ANDs every content word, so a
--     natural-language question ("what GDPR Article 99 says about AI training data")
--     requires all lexemes in one chunk and matches nothing. Rebuild the query as an
--     OR of the input's normalized lexemes: recall-oriented, as the keyword arm
--     should be (precision is restored downstream by rerank + RRF fusion with dense).
--     Lexemes come from to_tsvector('english', …) so stopwords are dropped and stems
--     match the stored `tsv` column; they are matched with the 'simple' config so they
--     are not stemmed a second time.
--
-- (2) Add citation-aware lookup. When a query names a specific unit ("Article 99",
--     "Art. 30"), match it by citation_label even when its body text is unrelated to
--     the rest of the query — the number lives in the label, not the text. Serves
--     both exact lookups and the identifier-style anchors of the other frameworks.

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
  with q as (
    select nullif(array_to_string(tsvector_to_array(to_tsvector('english', query_text)), ' | '), '')
      as or_terms
  )
  select c.id, c.parent_id, c.framework_id, c.hierarchy_path, c.citation_label, c.text,
    ts_rank(c.tsv, to_tsquery('simple', q.or_terms)) as rank
  from chunks c, q
  where c.snapshot_id = p_snapshot_id
    and (p_framework_id is null or c.framework_id = p_framework_id)
    and q.or_terms is not null
    and c.tsv @@ to_tsquery('simple', q.or_terms)
  order by rank desc
  limit match_count;
$$;

-- Match chunks whose citation_label matches any of the given ILIKE patterns
-- (e.g. 'Art. 99%' matches 'Art. 99(1)' and 'Art. 99(2)'). Patterns are produced by
-- the retrieval layer from citation-like tokens found in the user's input.
create or replace function match_chunks_by_citation(
  patterns text[],
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
  text text
)
language sql stable as $$
  select c.id, c.parent_id, c.framework_id, c.hierarchy_path, c.citation_label, c.text
  from chunks c
  where c.snapshot_id = p_snapshot_id
    and (p_framework_id is null or c.framework_id = p_framework_id)
    and exists (
      select 1 from unnest(patterns) as pat where c.citation_label ilike pat
    )
  order by c.citation_label
  limit match_count;
$$;
