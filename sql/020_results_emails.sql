-- Results emails (Survivor and later events).
--
-- 1. Two switches per event: email every team its results when its heat
--    ends, and its final places when the event is finished and locked.
-- 2. result_emails: one row per team per kind ('heat' | 'final') - the
--    record that stops a team being emailed twice. Server only.
-- 3. team_result_links: passwordless "see all your splits" links. Only a
--    SHA-256 hash of the random token is stored. Server only.
--
-- The lock guard from sql/019 (guard_locked_event) is attached to teams,
-- waves, stations, scans, penalties and judge_team_assignments only - NOT
-- to these two tables, so final emails can be recorded right after an
-- event is locked. Do not add these tables to that guard.
--
-- Safe to run more than once. One transaction: all or nothing.

begin;

alter table events add column if not exists email_results_auto boolean not null default true;
alter table events add column if not exists email_final_auto boolean not null default true;

create table if not exists result_emails (
  id bigint generated always as identity primary key,
  team_id text not null references teams(id) on update cascade on delete cascade,
  kind text not null check (kind in ('heat', 'final')),
  status text not null check (status in ('sent', 'failed', 'skipped')),
  recipients int not null default 0,
  provider_id text,
  error text,                       -- short, e.g. 'HTTP 429'; never personal data
  sent_at timestamptz not null default now(),
  unique (team_id, kind)
);
alter table result_emails enable row level security;

create table if not exists team_result_links (
  token_hash text primary key,      -- hex SHA-256 of the token in the link
  team_id text not null references teams(id) on update cascade on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists team_result_links_team_idx on team_result_links (team_id);
create index if not exists team_result_links_expires_idx on team_result_links (expires_at);
alter table team_result_links enable row level security;

-- No policies on purpose: only the server (service role) reads or writes.
revoke all on result_emails, team_result_links from anon, authenticated;
grant all on result_emails, team_result_links to service_role;

commit;

-- Optional tidy-up (needs pg_cron, already used by sql/019): remove links
-- a week after they expire. Run once by hand if wanted:
--   select cron.schedule('expire-result-links', '30 0 * * *',
--     $$delete from public.team_result_links where expires_at < now() - interval '7 days';$$);
