# Ingestion pipeline (local, offline)

Local Node/TS scripts run by Claude Code against the Supabase project, per snapshot:
`parse -> structure -> chunk -> embed -> load -> validate`. See docs/BUILD_PLAN.md §B.

Parsers are deterministic and per-framework (system design §5.1); their reviewable
output lands in `/corpus-build/*.json` (committed, no embeddings).
