-- Rate limiting / cost caps on the generation endpoint (build plan §I step 2).
--
-- One insert-only row per /api/generate attempt (before the expensive pipeline runs),
-- so src/routes/api/generate.ts can count recent requests per session_id and per IP
-- and refuse with 429 once either threshold is exceeded. This is the same "everything
-- reproducible in Postgres" convention as the rest of the schema, rather than an
-- in-memory counter that wouldn't survive across Cloudflare Worker isolates/regions.
--
-- Same access-control convention as every other table (system design §14.1): RLS
-- enabled with ZERO policies — only the service-role admin client (server-side) can
-- read or write this table. Never carries user input text (PRD §13 privacy).

create table if not exists generation_requests (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  ip text not null,
  ts timestamptz not null default now()
);

create index if not exists generation_requests_session_ts_idx
  on generation_requests (session_id, ts desc);

create index if not exists generation_requests_ip_ts_idx
  on generation_requests (ip, ts desc);

alter table generation_requests enable row level security;
