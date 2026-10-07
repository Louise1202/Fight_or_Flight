-- Payment per athlete: the two athletes of a team often pay separately.
--
-- team_members.paid / paid_at: ticked off by the admin per athlete.
-- teams.paid stays as "the whole team has paid" and is kept in sync by a
-- trigger: it becomes true when every athlete of the team has paid, and
-- false again if one is unticked. Teams without athlete records (added by
-- hand, or the 19 Sept event) keep using teams.paid directly.
--
-- Safe to run more than once. One transaction: all or nothing.

begin;

alter table team_members add column if not exists paid boolean not null default false;
alter table team_members add column if not exists paid_at timestamptz;

create or replace function sync_team_paid() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tid text := coalesce(NEW.team_id, OLD.team_id);
begin
  update teams t
  set paid = coalesce((select bool_and(m.paid) from team_members m where m.team_id = tid), t.paid)
  where t.id = tid
    and t.paid is distinct from coalesce((select bool_and(m.paid) from team_members m where m.team_id = tid), t.paid);
  return null;
end;
$$;

drop trigger if exists team_members_sync_paid on team_members;
create trigger team_members_sync_paid
  after insert or update of paid or delete on team_members
  for each row execute function sync_team_paid();

commit;
