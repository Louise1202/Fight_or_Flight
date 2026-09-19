-- Run stations (is_run = true, e.g. "400m Run") are never scanned
-- directly by a judge - their time is automatic, calculated from the
-- gap between confirming one real station and the next. The trigger
-- previously assumed every station number in sequence gets its own
-- arrive/leave pair; it now skips straight past any run station when
-- working out what's expected next, exactly matching what the app
-- itself no longer asks a judge to confirm.
create or replace function validate_scan_sequence()
returns trigger as $$
declare
  last_scan record;
  expected_station int;
  expected_event text;
  max_station int;
begin
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

  select coalesce(max(number), 0) into max_station from stations;

  if last_scan is null then
    -- First scan of the race - the first REAL (non-run) station, not
    -- necessarily station 1 if the course opens with a run.
    select min(number) into expected_station from stations where not is_run;
    if expected_station is null then
      expected_station := 1; -- fallback if every station is somehow a run
    end if;
    expected_event := 'arrive';
  elsif last_scan.event_type = 'arrive' then
    expected_station := last_scan.station_number;
    expected_event := 'leave';
  else
    -- Just left a real station - the next expected arrival is the next
    -- REAL station after this one, skipping any run station(s) in
    -- between. If none remain, the finish line (one past the highest
    -- station number) is expected instead.
    select min(number) into expected_station
    from stations
    where number > last_scan.station_number and not is_run;
    if expected_station is null then
      expected_station := max_station + 1;
    end if;
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
