-- This is the real enforcement point for scan order. It runs inside
-- Postgres itself, so it protects the data no matter what inserts the
-- row - the judge's phone, the manual-entry fallback, a future admin
-- tool, or anything else. The app's own logic (lib/timing.ts) computes
-- the same "what's next" answer for display purposes, but this trigger
-- is what actually guarantees bad data can't get written.
create or replace function validate_scan_sequence()
returns trigger as $$
declare
  last_scan record;
  expected_station int;
  expected_event text;
begin
  -- If this exact scan (by its client-generated id) was already
  -- recorded, don't re-validate it against the *new* current state -
  -- just let it through here and let the unique constraint on
  -- client_scan_id reject it as the duplicate it is. This keeps
  -- "already recorded" and "wrong station" as two distinct, correctly
  -- identified error cases for the app to handle differently.
  if NEW.client_scan_id is not null and exists (
    select 1 from scans where client_scan_id = NEW.client_scan_id
  ) then
    return NEW;
  end if;

  select station_number, event_type into last_scan
  from scans
  where team_id = NEW.team_id
  order by scanned_at desc
  limit 1;

  if last_scan is null then
    expected_station := 1;
    expected_event := 'arrive';
  elsif last_scan.event_type = 'arrive' then
    expected_station := last_scan.station_number;
    expected_event := 'leave';
  else
    expected_station := last_scan.station_number + 1;
    expected_event := 'arrive';
  end if;

  if NEW.station_number is distinct from expected_station
     or NEW.event_type is distinct from expected_event then
    raise exception 'INVALID_SCAN: expected station % (%), got station % (%)',
      expected_station, expected_event, NEW.station_number, NEW.event_type;
  end if;

  return NEW;
end;
$$ language plpgsql;

drop trigger if exists scans_validate_sequence on scans;
create trigger scans_validate_sequence
  before insert on scans
  for each row execute function validate_scan_sequence();
