alter table waves add column actual_end timestamptz;

-- Fires after every scan. If this scan was a team crossing the finish
-- line (station 13, arrive), it checks whether every team in that same
-- heat has now also finished - if so, the heat is automatically closed.
-- This only ever sets actual_end once (the `actual_end is null` guard),
-- so it can't be re-triggered or overwritten by itself.
create or replace function maybe_close_heat()
returns trigger as $$
declare
  team_wave int;
  total_teams int;
  finished_teams int;
begin
  if NEW.station_number = 13 and NEW.event_type = 'arrive' then
    select wave into team_wave from teams where id = NEW.team_id;

    if team_wave is not null then
      select count(*) into total_teams
      from teams
      where wave = team_wave;

      select count(distinct team_id) into finished_teams
      from scans
      where station_number = 13
        and event_type = 'arrive'
        and team_id in (select id from teams where wave = team_wave);

      if finished_teams >= total_teams then
        update waves
        set actual_end = now()
        where wave_number = team_wave and actual_end is null;
      end if;
    end if;
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists scans_maybe_close_heat on scans;
create trigger scans_maybe_close_heat
  after insert on scans
  for each row execute function maybe_close_heat();
