-- Admin edits a team's name and its athletes' names in ONE place.
--
-- Athlete names are stored twice: team_members (first_name, surname -
-- used by Registrations, the signed form, the medic sheet and emails)
-- and teams.athlete_1 / athlete_2 (used by results, the big screen and
-- the judges). This function changes both together, so they can't drift
-- apart again.
--
-- Only names change. Nothing is deleted; payments, heats, signatures,
-- medical answers and contact details are untouched. Safe to run more
-- than once.

begin;

create or replace function admin_set_team_names(p_team_id text, p_team_name text, p_names jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  n jsonb;
begin
  if not exists (select 1 from teams where id = p_team_id) then
    raise exception 'NO_SUCH_TEAM' using errcode = 'RT013';
  end if;

  if p_team_name is not null then
    update teams set team_name = p_team_name where id = p_team_id;
  end if;

  for n in select * from jsonb_array_elements(coalesce(p_names, '[]'::jsonb)) loop
    update team_members
       set first_name = n->>'first_name', surname = n->>'surname'
     where team_id = p_team_id and position = (n->>'position')::smallint;
    -- The copy shown on results follows the athlete record.
    if (n->>'position') = '1' then
      update teams set athlete_1 = (n->>'first_name') || ' ' || (n->>'surname') where id = p_team_id;
    elsif (n->>'position') = '2' then
      update teams set athlete_2 = (n->>'first_name') || ' ' || (n->>'surname') where id = p_team_id;
    end if;
  end loop;
end;
$$;
revoke all on function admin_set_team_names(text, text, jsonb) from public, anon, authenticated;
grant execute on function admin_set_team_names(text, text, jsonb) to service_role;

commit;
