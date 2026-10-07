-- Multi-event support (Survivor, 7 Nov 2026) without touching the
-- 19 Sept 2026 Fight or Flight results.
--
-- What this does, in order:
--  1. An `events` table. Every team, heat and station now belongs to one
--     event. Everything that already exists is assigned to the Fight or
--     Flight event, which is then LOCKED.
--  2. A lock guard: once an event is locked, the database itself refuses
--     any insert, update or delete of its teams, heats, stations, scans,
--     penalties and judge assignments - whatever the app or a person asks.
--  3. Scan rules (validate_scan_sequence, maybe_close_heat) look only at
--     the team's own event. Heat auto-close no longer hard-codes station 13.
--  4. Undo last scan through a checked database function (the delete
--     permission it relied on never existed in production).
--  5. Tables for self-registration (team members, medical answers kept
--     apart and erased automatically), a rate limiter, and a daily clean-up.
--  6. Realtime switched on for the tables the app listens to.
--
-- Safe to run once. It is a single transaction: if any statement fails,
-- nothing at all is changed.

begin;

-- ---------------------------------------------------------------------
-- 1. Events
-- ---------------------------------------------------------------------
create table if not exists events (
  id text primary key,                         -- e.g. 'survivor-2026-11-07'
  name text not null,
  event_date date not null,
  venue text,
  registration_time text,                      -- shown as-is, e.g. '06:00'
  theme text not null default 'fof' check (theme in ('fof', 'survivor')),
  team_id_prefix text not null check (team_id_prefix ~ '^[A-Z]{2,4}$'),
  -- 'heat_position' = the original FF + HHMM + position ids (Fight or Flight)
  -- 'sequential'    = prefix + 001, 002 ... in sign-up order, never changes
  team_id_scheme text not null default 'sequential'
    check (team_id_scheme in ('heat_position', 'sequential')),
  next_team_number int not null default 1,
  heat_minutes int not null default 60 check (heat_minutes between 10 and 240),
  registration_open boolean not null default false,
  entry_fee text,                              -- free text set by the admin, e.g. 'R400 per team'
  bank_details text,                           -- free text set by the admin
  status text not null default 'setup' check (status in ('setup', 'live', 'finished')),
  locked boolean not null default false,
  created_at timestamptz not null default now()
);

insert into events (id, name, event_date, theme, team_id_prefix, team_id_scheme, status)
values ('fof-2026-09-19', 'Fight or Flight', '2026-09-19', 'fof', 'FF', 'heat_position', 'finished')
on conflict (id) do nothing;

alter table events enable row level security;
-- Public event facts (name, date, venue, fee, bank details) - shown on the
-- sign-up page. Writes only through admin API routes (service role).
drop policy if exists "anyone can read events" on events;
create policy "anyone can read events" on events for select to anon, authenticated using (true);

alter table app_settings add column if not exists active_event_id text references events(id);
update app_settings set active_event_id = 'fof-2026-09-19' where id = 1 and active_event_id is null;

-- ---------------------------------------------------------------------
-- 2. event_id on teams, heats and stations
-- ---------------------------------------------------------------------
alter table teams add column if not exists event_id text references events(id);
update teams set event_id = 'fof-2026-09-19' where event_id is null;
alter table teams alter column event_id set not null;

-- Registration status. Everything from 19 Sept was a confirmed entry.
alter table teams add column if not exists status text not null default 'confirmed'
  check (status in ('registered', 'confirmed', 'withdrawn'));
alter table teams add column if not exists registered_at timestamptz;
alter table teams add column if not exists paid boolean not null default false;
create index if not exists teams_event_idx on teams (event_id, wave);

-- Team names must be unique within an event (case-insensitive), except in
-- the original Fight or Flight event, where "Team 01" per heat was the
-- intended design.
create unique index if not exists teams_unique_name_per_event
  on teams (event_id, lower(team_name))
  where event_id <> 'fof-2026-09-19' and status <> 'withdrawn';

alter table waves add column if not exists event_id text references events(id);
update waves set event_id = 'fof-2026-09-19' where event_id is null;
alter table waves alter column event_id set not null;
alter table waves add column if not exists end_reason text
  check (end_reason in ('all_finished', 'time_limit', 'manual'));
alter table waves drop constraint if exists waves_pkey;
alter table waves add constraint waves_pkey primary key (event_id, wave_number);

alter table stations add column if not exists event_id text references events(id);
update stations set event_id = 'fof-2026-09-19' where event_id is null;
alter table stations alter column event_id set not null;
-- Short detail line shown under the station name, e.g. "240m · 2x 24kg / 2x 16kg".
alter table stations add column if not exists detail text;
alter table stations drop constraint if exists stations_pkey;
alter table stations add constraint stations_pkey primary key (event_id, number);

-- Judges are kept (never deleted) so old results keep their names.
alter table judges add column if not exists active boolean not null default true;

-- Scans: the lookup every trigger and refresh does.
create index if not exists scans_team_time_idx on scans (team_id, scanned_at);

-- A penalty always adds time.
alter table penalties drop constraint if exists penalties_positive;
alter table penalties add constraint penalties_positive check (penalty_seconds > 0) not valid;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function event_of_team(p_team_id text) returns text
language sql stable security definer set search_path = public as $$
  select event_id from teams where id = p_team_id
$$;

create or replace function event_is_locked(p_event_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select locked from events where id = p_event_id), false)
$$;

-- The finish line is one past the event's highest station number.
create or replace function event_finish_number(p_event_id text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(max(number), 0) + 1 from stations where event_id = p_event_id
$$;

-- True when nothing (no run) comes after the last real station, so
-- leaving that station IS the finish.
create or replace function event_finishes_at_last_station(p_event_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from stations r
    where r.event_id = p_event_id and r.is_run
      and r.number > (select max(number) from stations s where s.event_id = p_event_id and not s.is_run)
  )
$$;

-- ---------------------------------------------------------------------
-- 3. Lock guard
-- ---------------------------------------------------------------------
create or replace function guard_locked_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ev_old text;
  ev_new text;
begin
  if TG_TABLE_NAME in ('teams', 'waves', 'stations') then
    if TG_OP <> 'INSERT' then ev_old := OLD.event_id; end if;
    if TG_OP <> 'DELETE' then ev_new := NEW.event_id; end if;
  else
    -- scans, penalties, judge_team_assignments: via the team
    if TG_OP <> 'INSERT' then ev_old := event_of_team(OLD.team_id); end if;
    if TG_OP <> 'DELETE' then ev_new := event_of_team(NEW.team_id); end if;
  end if;

  if event_is_locked(ev_old) or event_is_locked(ev_new) then
    raise exception 'EVENT_LOCKED: this event is finished and locked; its results cannot be changed'
      using errcode = 'RT001';
  end if;

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

-- Unlocking an event is deliberately not possible from the app. It needs
-- this exact setting in the same SQL session:
--   set local app.allow_unlock = 'yes';
create or replace function guard_event_unlock() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.locked then
      raise exception 'EVENT_LOCKED: a locked event cannot be deleted' using errcode = 'RT001';
    end if;
    return OLD;
  end if;
  if OLD.locked and not NEW.locked
     and coalesce(current_setting('app.allow_unlock', true), '') <> 'yes' then
    raise exception 'EVENT_LOCKED: unlocking an event can only be done by hand in SQL'
      using errcode = 'RT001';
  end if;
  return NEW;
end;
$$;
drop trigger if exists events_guard_unlock on events;
create trigger events_guard_unlock before update or delete on events
  for each row execute function guard_event_unlock();

do $$
declare t text;
begin
  foreach t in array array['teams', 'waves', 'stations', 'scans', 'penalties', 'judge_team_assignments'] loop
    execute format('drop trigger if exists %I on %I', t || '_guard_locked', t);
    execute format(
      'create trigger %I before insert or update or delete on %I for each row execute function guard_locked_event()',
      t || '_guard_locked', t);
  end loop;
end $$;

-- A team that has results can't be deleted (withdraw it instead). This
-- replaces the silent ON DELETE CASCADE that used to wipe its scans.
create or replace function guard_team_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from scans where team_id = OLD.id) then
    raise exception 'TEAM_HAS_RESULTS: this team has recorded scans; withdraw it instead of deleting'
      using errcode = 'RT002';
  end if;
  return OLD;
end;
$$;
drop trigger if exists teams_guard_delete on teams;
create trigger teams_guard_delete before delete on teams
  for each row execute function guard_team_delete();

-- Team ids may only change before the team's heat has started.
create or replace function guard_team_id_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.id is distinct from OLD.id then
    if exists (select 1 from scans where team_id = OLD.id)
       or exists (select 1 from waves w where w.event_id = OLD.event_id
                    and w.wave_number = OLD.wave and w.actual_start is not null) then
      raise exception 'TEAM_ID_FROZEN: a team id cannot change once its heat has started'
        using errcode = 'RT003';
    end if;
  end if;
  return NEW;
end;
$$;
drop trigger if exists teams_guard_id_change on teams;
create trigger teams_guard_id_change before update of id on teams
  for each row execute function guard_team_id_change();

-- ---------------------------------------------------------------------
-- 4. Scan rules, per event
-- ---------------------------------------------------------------------
create or replace function validate_scan_sequence() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  last_scan record;
  expected_station int;
  expected_event text;
  ev text;
begin
  if NEW.client_scan_id is not null and exists (
    select 1 from scans where client_scan_id = NEW.client_scan_id
  ) then
    return NEW;
  end if;

  ev := event_of_team(NEW.team_id);

  select station_number, event_type into last_scan
  from scans
  where team_id = NEW.team_id
  order by scanned_at desc, id desc
  limit 1;

  if last_scan is null then
    select min(number) into expected_station from stations where event_id = ev and not is_run;
    if expected_station is null then expected_station := 1; end if;
    expected_event := 'arrive';
  elsif last_scan.event_type = 'arrive' then
    expected_station := last_scan.station_number;
    expected_event := 'leave';
  else
    select min(number) into expected_station
    from stations
    where event_id = ev and number > last_scan.station_number and not is_run;
    if expected_station is null then
      expected_station := event_finish_number(ev);
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
$$;

create or replace function maybe_close_heat() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ev text;
  team_wave int;
  total_teams int;
  finished_teams int;
  finish_no int;
begin
  if NEW.event_type <> 'arrive' then return NEW; end if;

  select event_id, wave into ev, team_wave from teams where id = NEW.team_id;
  finish_no := event_finish_number(ev);
  if NEW.station_number <> finish_no or team_wave is null then return NEW; end if;

  select count(*) into total_teams
  from teams where event_id = ev and wave = team_wave and status <> 'withdrawn';

  select count(distinct s.team_id) into finished_teams
  from scans s join teams t on t.id = s.team_id
  where t.event_id = ev and t.wave = team_wave and t.status <> 'withdrawn'
    and s.station_number = finish_no and s.event_type = 'arrive';

  if finished_teams >= total_teams then
    update waves set actual_end = now(), end_reason = 'all_finished'
    where event_id = ev and wave_number = team_wave and actual_end is null;
  end if;

  return NEW;
end;
$$;

-- Scans for a heat that has ended are refused, except when the scan was
-- actually tapped before the end (an offline phone catching up).
create or replace function refuse_scans_after_heat_end() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  heat_end timestamptz;
begin
  select w.actual_end into heat_end
  from teams t join waves w on w.event_id = t.event_id and w.wave_number = t.wave
  where t.id = NEW.team_id;
  if heat_end is not null and NEW.scanned_at > heat_end + interval '2 seconds' then
    raise exception 'HEAT_ENDED: this heat has ended' using errcode = 'RT004';
  end if;
  return NEW;
end;
$$;
drop trigger if exists scans_refuse_after_heat_end on scans;
create trigger scans_refuse_after_heat_end before insert on scans
  for each row execute function refuse_scans_after_heat_end();

-- Undo: removes the team's latest scan. If that scan was the finish and
-- the course finishes at the last station, the paired "leave" goes too
-- (one tap on the phone created both). Only the team's own judge can do
-- this, and never on a locked event or a heat stopped by the time limit.
create or replace function undo_last_scan(p_team_id text)
returns table (removed int)
language plpgsql security definer set search_path = public as $$
declare
  ev text;
  last_row scans%rowtype;
  prev_row scans%rowtype;
  n int := 0;
  w waves%rowtype;
begin
  if auth.role() <> 'service_role' and not (is_active_judge() and exists (
    select 1 from judge_team_assignments
    where team_id = p_team_id and judge_id = auth.uid()
  )) then
    raise exception 'NOT_YOUR_TEAM' using errcode = '42501';
  end if;

  ev := event_of_team(p_team_id);

  select w2.* into w from teams t join waves w2 on w2.event_id = t.event_id and w2.wave_number = t.wave
  where t.id = p_team_id;
  if w.actual_end is not null and coalesce(w.end_reason, 'manual') <> 'all_finished' then
    raise exception 'HEAT_ENDED: this heat has ended' using errcode = 'RT004';
  end if;

  select * into last_row from scans where team_id = p_team_id
  order by scanned_at desc, id desc limit 1;
  if last_row.id is null then return query select 0; return; end if;

  delete from scans where id = last_row.id;
  n := 1;

  if last_row.event_type = 'arrive'
     and last_row.station_number = event_finish_number(ev)
     and event_finishes_at_last_station(ev) then
    select * into prev_row from scans where team_id = p_team_id
    order by scanned_at desc, id desc limit 1;
    if prev_row.id is not null and prev_row.event_type = 'leave'
       and last_row.scanned_at - prev_row.scanned_at < interval '5 seconds' then
      delete from scans where id = prev_row.id;
      n := 2;
    end if;
  end if;

  -- The heat closed itself because everyone had finished; undoing a
  -- finish re-opens it.
  if w.end_reason = 'all_finished' then
    update waves set actual_end = null, end_reason = null
    where event_id = w.event_id and wave_number = w.wave_number;
  end if;

  return query select n;
end;
$$;
revoke all on function undo_last_scan(text) from public, anon;
grant execute on function undo_last_scan(text) to authenticated;

-- Stopped-team note: only the team's own judge.
create or replace function set_stopped_note(p_team_id text, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_active_judge() and exists (
    select 1 from judge_team_assignments
    where team_id = p_team_id and judge_id = auth.uid()
  )) then
    raise exception 'NOT_YOUR_TEAM' using errcode = '42501';
  end if;
  update teams set stopped_note = nullif(trim(left(p_note, 500)), '') where id = p_team_id;
end;
$$;
revoke all on function set_stopped_note(text, text) from public, anon;
grant execute on function set_stopped_note(text, text) to authenticated;

-- True only for a judge who is signed in AND still active.
create or replace function is_active_judge() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from judges where id = auth.uid() and active)
$$;

-- Scan inserts must be made as the judge who is signed in, and only by
-- an active judge (a deactivated judge's login can no longer record).
drop policy if exists "judges insert own team scans" on scans;
create policy "judges insert own team scans" on scans for insert
with check (
  judge_id = auth.uid()
  and is_active_judge()
  and team_id in (select team_id from judge_team_assignments where judge_id = auth.uid())
);
drop policy if exists "judges insert own team penalties" on penalties;
create policy "judges insert own team penalties" on penalties for insert
with check (
  judge_id = auth.uid()
  and is_active_judge()
  and team_id in (select team_id from judge_team_assignments where judge_id = auth.uid())
);

-- ---------------------------------------------------------------------
-- 5. Registration
-- ---------------------------------------------------------------------
-- Personal details per athlete. No RLS policies at all: only the server
-- (service role) can read or write. Never visible to judges or teams.
create table if not exists team_members (
  id bigint generated always as identity primary key,
  team_id text not null references teams(id) on update cascade on delete cascade,
  position smallint not null check (position in (1, 2)),
  first_name text not null,
  surname text not null,
  gender text not null check (gender in ('male', 'female')),
  phone text not null,
  email text not null,
  emergency_name text not null,
  emergency_phone text not null,
  emergency_relationship text,
  consents jsonb not null,               -- which statements were accepted, and the wording version
  signature_png text,                    -- data:image/png;base64,... drawn on the phone
  signed_at timestamptz not null default now(),
  unique (team_id, position)
);
alter table team_members enable row level security;

-- Health information, kept apart and erased automatically (POPIA).
create table if not exists member_medical (
  member_id bigint primary key references team_members(id) on delete cascade,
  answers jsonb not null,
  details text,
  erase_after date not null
);
alter table member_medical enable row level security;

-- Simple fixed-window rate limiter for sign-up and logins.
create table if not exists rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table rate_limits enable row level security;

create or replace function hit_rate_limit(p_key text, p_max int, p_window_seconds int)
returns boolean   -- true = allowed, false = too many
language plpgsql security definer set search_path = public as $$
declare
  ws timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c int;
begin
  insert into rate_limits (key, window_start, hits) values (p_key, ws, 1)
  on conflict (key, window_start) do update set hits = rate_limits.hits + 1
  returning hits into c;
  return c <= p_max;
end;
$$;
revoke all on function hit_rate_limit(text, int, int) from public, anon, authenticated;

-- One call registers a whole team atomically: team row with the next
-- permanent Team ID, both members, medical answers. Called only by the
-- server after it has validated every field.
create or replace function register_team(p_event_id text, p_team jsonb, p_members jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  ev events%rowtype;
  new_id text;
  m jsonb;
  member_id bigint;
  team_name text;
begin
  select * into ev from events where id = p_event_id for update;
  if ev.id is null then raise exception 'NO_SUCH_EVENT' using errcode = 'RT010'; end if;
  if not ev.registration_open or ev.locked then
    raise exception 'REGISTRATION_CLOSED' using errcode = 'RT011';
  end if;
  if ev.team_id_scheme <> 'sequential' then
    raise exception 'REGISTRATION_NOT_SUPPORTED' using errcode = 'RT012';
  end if;

  new_id := ev.team_id_prefix || lpad(ev.next_team_number::text, 3, '0');
  update events set next_team_number = next_team_number + 1 where id = ev.id;

  team_name := nullif(trim(p_team->>'team_name'), '');
  if team_name is null then team_name := 'Team ' || new_id; end if;

  insert into teams (id, event_id, team_name, athlete_1, athlete_2, division, wave, start_time,
                     status, registered_at)
  values (
    new_id, ev.id, team_name,
    (p_members->0->>'first_name') || ' ' || (p_members->0->>'surname'),
    (p_members->1->>'first_name') || ' ' || (p_members->1->>'surname'),
    p_team->>'division', null, ev.event_date::timestamptz,
    'registered', now()
  );

  for m in select * from jsonb_array_elements(p_members) loop
    insert into team_members (team_id, position, first_name, surname, gender, phone, email,
                              emergency_name, emergency_phone, emergency_relationship,
                              consents, signature_png)
    values (new_id, (m->>'position')::smallint, m->>'first_name', m->>'surname', m->>'gender',
            m->>'phone', m->>'email', m->>'emergency_name', m->>'emergency_phone',
            nullif(m->>'emergency_relationship', ''), m->'consents', m->>'signature_png')
    returning id into member_id;

    insert into member_medical (member_id, answers, details, erase_after)
    values (member_id, coalesce(m->'medical', '{}'::jsonb), nullif(m->>'medical_details', ''),
            ev.event_date + 30);
  end loop;

  return new_id;
end;
$$;
revoke all on function register_team(text, jsonb, jsonb) from public, anon, authenticated;

-- Next permanent Team ID for a team the admin adds by hand to a
-- 'sequential' event (same numbering as self-registration).
create or replace function allocate_team_id(p_event_id text)
returns text
language plpgsql security definer set search_path = public as $$
declare ev events%rowtype;
begin
  select * into ev from events where id = p_event_id for update;
  if ev.id is null then raise exception 'NO_SUCH_EVENT' using errcode = 'RT010'; end if;
  if ev.team_id_scheme <> 'sequential' then
    raise exception 'REGISTRATION_NOT_SUPPORTED' using errcode = 'RT012';
  end if;
  update events set next_team_number = next_team_number + 1 where id = ev.id;
  return ev.team_id_prefix || lpad(ev.next_team_number::text, 3, '0');
end;
$$;
revoke all on function allocate_team_id(text) from public, anon, authenticated;

-- Belt and braces on top of RLS: the browser roles get no table rights at
-- all on the private tables, and no TRUNCATE/TRIGGER rights anywhere.
revoke all on team_members, member_medical, rate_limits from anon, authenticated;
grant all on events, team_members, member_medical, rate_limits to service_role;
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
grant select on events to anon, authenticated;

-- TRUNCATE skips row triggers, so it gets its own guard: refused on any
-- table that holds data of a locked event.
create or replace function guard_truncate_locked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from events where locked) then
    raise exception 'EVENT_LOCKED: % cannot be emptied while it holds a locked event', TG_TABLE_NAME
      using errcode = 'RT001';
  end if;
  return null;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['teams', 'waves', 'stations', 'scans', 'penalties', 'judge_team_assignments', 'team_viewers', 'judges'] loop
    execute format('drop trigger if exists %I on %I', t || '_guard_truncate', t);
    execute format(
      'create trigger %I before truncate on %I for each statement execute function guard_truncate_locked()',
      t || '_guard_truncate', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Lock the Fight or Flight event (last, after every backfill above)
-- ---------------------------------------------------------------------
update events set locked = true where id = 'fof-2026-09-19';

-- ---------------------------------------------------------------------
-- 7. Realtime for what the app listens to
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['waves', 'scans', 'teams', 'app_settings', 'penalties'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- 8. Daily clean-up (outside the transaction: needs the pg_cron extension)
--    - medical answers erased 30 days after their event
--    - old rate-limit counters removed
-- ---------------------------------------------------------------------
create extension if not exists pg_cron;
select cron.schedule(
  'erase-medical-and-rate-limits',
  '15 0 * * *',
  $$delete from public.member_medical where erase_after < current_date;
    delete from public.rate_limits where window_start < now() - interval '2 days';$$
);
