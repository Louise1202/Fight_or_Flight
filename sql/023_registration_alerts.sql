-- Registration alerts: admin email addresses that get an email when a
-- team's spot is booked, the team is confirmed, or it is withdrawn.
--
-- Kept in its own table (not on events, which the public can read), with
-- RLS on and no policies: only the server can read or change it.
--
-- Nothing is deleted. Safe to run more than once.

begin;

create table if not exists event_alerts (
  event_id text primary key references events(id) on update cascade on delete cascade,
  emails text[] not null default '{}',
  on_booked boolean not null default true,
  on_confirmed boolean not null default true,
  on_withdrawn boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint event_alerts_max_emails check (coalesce(array_length(emails, 1), 0) <= 10)
);
alter table event_alerts enable row level security;

revoke all on event_alerts from anon, authenticated;
grant all on event_alerts to service_role;

commit;
