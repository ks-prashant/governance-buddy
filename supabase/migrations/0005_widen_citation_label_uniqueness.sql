-- 0005 — widen chunk citation-label uniqueness to include framework_id (Phase E).
--
-- The original chunks_citation_label_unique_idx (snapshot_id, citation_label), from 0001,
-- was correct for a single-framework (GDPR) snapshot. A combined FIVE-framework snapshot
-- legitimately reuses the same label across frameworks — GDPR "Art. 5(1)" vs EU AI Act
-- "Art. 5(1)" — so labels are only unique WITHIN a framework, not globally. The Phase E
-- corpus has 435 such cross-framework duplicate child labels; the old index would reject
-- the combined load outright.
--
-- framework_id already disambiguates them (it's carried on every chunk, denormalized for
-- filtering), and citation display stays framework-native. Per-framework uniqueness — the
-- invariant the ingestion validate gate (ingestion/validate.ts) actually checks — is still
-- enforced. This is idempotent and safe to re-run.

drop index if exists chunks_citation_label_unique_idx;

create unique index if not exists chunks_citation_label_unique_idx
  on chunks (snapshot_id, framework_id, citation_label);
