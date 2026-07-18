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