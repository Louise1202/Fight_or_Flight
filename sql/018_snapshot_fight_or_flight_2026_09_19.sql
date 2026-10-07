-- Read-only safety copy of the 19 Sept 2026 Fight or Flight event, taken
-- before the multi-event changes. Lives in its own schema, which the app
-- never reads or writes, so no reset or delete in the app can touch it.
-- Applied to production on 2026-10-07. Verified: 35 teams, 875 scans,
-- 2 penalties, 4 waves, 24 stations, 24 judges, 35 team logins, 46
-- assignments, 59 login usernames; scans byte-for-byte identical.
--
-- Not re-runnable on purpose: if this schema already exists, the
-- "create table ... as" lines fail and nothing is overwritten.
create schema if not exists archive_fof_2026_09_19;
revoke all on schema archive_fof_2026_09_19 from public, anon, authenticated;
create table archive_fof_2026_09_19.teams as select * from public.teams;
create table archive_fof_2026_09_19.scans as select * from public.scans;
create table archive_fof_2026_09_19.penalties as select * from public.penalties;
create table archive_fof_2026_09_19.waves as select * from public.waves;
create table archive_fof_2026_09_19.stations as select * from public.stations;
create table archive_fof_2026_09_19.judges as select * from public.judges;
create table archive_fof_2026_09_19.team_viewers as select * from public.team_viewers;
create table archive_fof_2026_09_19.judge_team_assignments as select * from public.judge_team_assignments;
create table archive_fof_2026_09_19.app_settings as select * from public.app_settings;
create table archive_fof_2026_09_19.login_usernames as select id, email, created_at from auth.users;
