-- Heat emails: which heat and start time each team was emailed, so a team
-- is emailed once and the admin can see when its heat changed afterwards.
--
-- Server only (RLS on, no policies). Nothing is deleted. Safe to run more
-- than once.

begin;

create table if not exists heat_emails (
  team_id text primary key references teams(id) on update cascade on delete cascade,
  wave integer not null,
  scheduled_start timestamptz not null,
  status text not null check (status in ('sent', 'failed')),
  recipients integer not null default 0,
  error text,
  sent_at timestamptz not null default now()
);
alter table heat_emails enable row level security;

revoke all on heat_emails from anon, authenticated;
grant all on heat_emails to service_role;

commit;
