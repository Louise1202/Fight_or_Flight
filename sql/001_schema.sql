create table teams (
  id text primary key,              -- e.g. 'FF073001'
  team_name text,
  athlete_1 text,
  athlete_2 text,
  division text,
  wave int,
  start_time timestamptz
);

create table judges (
  id uuid primary key references auth.users(id),
  name text
);

create table team_viewers (
  id uuid primary key references auth.users(id),
  team_id text references teams(id)
);

create table judge_team_assignments (
  judge_id uuid references judges(id),
  team_id text references teams(id),
  primary key (judge_id, team_id)
);

create table scans (
  id bigint generated always as identity primary key,
  team_id text references teams(id),
  station_number int,                 -- 1-12 stations, 13 = finish
  event_type text check (event_type in ('arrive','leave')),
  scanned_at timestamptz default now(),
  judge_id uuid references judges(id)
);

create table penalties (
  id bigint generated always as identity primary key,
  team_id text references teams(id),
  station_number int,
  penalty_seconds int,
  judge_id uuid references judges(id),
  created_at timestamptz default now(),
  notes text
);
