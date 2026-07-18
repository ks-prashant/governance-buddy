drop index if exists chunks_citation_label_unique_idx;
create unique index if not exists chunks_citation_label_unique_idx
  on chunks (snapshot_id, framework_id, citation_label);