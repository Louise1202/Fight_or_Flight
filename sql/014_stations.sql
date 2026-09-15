-- Stations move from a hardcoded array in lib/timing.ts to real data, so
-- they can be built/edited by the admin (in the UI or via the Excel
-- event report) without a code change. Seeded with exactly the current
-- 12 stations, in order, so nothing changes for this event until someone
-- actually edits the list. The finish line is deliberately NOT a row
-- here - it's always computed as one past the highest station number
-- (see lib/stations.ts, withFinish()).

create table if not exists stations (
  number int primary key,
  name text not null
);

insert into stations (number, name) values
  (1, 'KB Farmers Carry'),
  (2, 'KB Deadlift'),
  (3, 'DB Lunges'),
  (4, 'DB Snatch'),
  (5, 'Burpee Broad Jumps'),
  (6, 'KB Goblet Squat'),
  (7, 'Weight Plate Front Carry'),
  (8, 'DB Push Press'),
  (9, 'Bear Crawl'),
  (10, 'Weight Plate Clean and Press'),
  (11, 'Weight Plate Overhead Carry'),
  (12, 'DB Devil Press')
on conflict (number) do nothing;

alter table stations enable row level security;

-- Read-only for everyone logged in, AND for the admin's own browser
-- (which is never Supabase-authenticated - see the app_settings
-- migrations from earlier for why anon needs its own policy too).
-- Nothing sensitive here, and nothing ever writes to this table except
-- through an admin-session-gated API route using the service role.
-- Dropped first so this migration can be safely re-run - Postgres has
-- no "create policy if not exists", and without this, hitting "policy
-- already exists" here rolls back the WHOLE script as one transaction,
-- including the insert above, even though the insert itself succeeded.
drop policy if exists "authenticated can read stations" on stations;
create policy "authenticated can read stations"
on stations for select
to authenticated
using (true);

drop policy if exists "anon can read stations" on stations;
create policy "anon can read stations"
on stations for select
to anon
using (true);
