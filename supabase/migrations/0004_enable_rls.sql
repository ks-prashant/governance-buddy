-- Critical security fix: enable RLS on every table, with NO policies.
--
-- Found via Lovable's security linter + verified empirically: with RLS disabled,
-- Supabase's default project template still GRANTs the `anon`/`authenticated`
-- Postgres roles table access — so the public, non-secret publishable/anon key
-- could read AND WRITE every table (confirmed live: wrote a row to
-- analytics_events, read eval_results/chunks/etc, all via the public REST API).
-- "RLS disabled" means "no restriction", not "no access" — the original design
-- reasoning (system design §14, "server-only access via service role") was right
-- about intent but wrong about mechanism. The correct way to make a table
-- server-only in Supabase is: ENABLE RLS with ZERO policies (default-deny for
-- anon/authenticated). The service_role key used by supabaseAdmin BYPASSES RLS
-- entirely regardless of policies — this is a Postgres/Supabase guarantee, not
-- something that needs configuring — so all server-side code is unaffected.
--
-- No public-read policies are added anywhere. If a future phase needs the browser
-- to read a table directly (it shouldn't, per system design §14), add a narrow,
-- explicit SELECT-only policy then — never broaden this migration's default-deny.

alter table frameworks enable row level security;
alter table corpus_snapshots enable row level security;
alter table framework_versions enable row level security;
alter table parents enable row level security;
alter table chunks enable row level security;
alter table conflicts enable row level security;
alter table eval_results enable row level security;
alter table analytics_events enable row level security;

-- Secondary hardening: pin search_path on the retrieval RPC functions (0002, 0003).
-- These run as SECURITY INVOKER (no `security definer`), so the elevated-privilege
-- search_path-hijack risk doesn't apply — but pinning it is a zero-cost Postgres
-- best practice the linter also flagged ("Function Search Path Mutable").
alter function match_chunks_dense(vector, uuid, text, int) set search_path = public, pg_temp;
alter function match_chunks_keyword(text, uuid, text, int) set search_path = public, pg_temp;
alter function match_chunks_by_citation(text[], uuid, text, int) set search_path = public, pg_temp;
