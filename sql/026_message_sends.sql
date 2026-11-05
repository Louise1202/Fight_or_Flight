-- One-off messages to teams (like the athlete briefing): which team got
-- which message, so nobody gets it twice and late teams can still get it.
--
-- Server only (RLS on, no policies). Nothing is deleted. Safe to run more
-- than once.

begin;

create table if not exists message_sends (
  team_id text not null references teams(id) on update cascade on delete cascade,
  message_key text not null,
  status text not null check (status in ('sent', 'failed')),
  recipients integer not null default 0,
  sent_at timestamptz not null default now(),
  primary key (team_id, message_key)
);
alter table message_sends enable row level security;

revoke all on message_sends from anon, authenticated;
grant all on message_sends to service_role;

commit;
