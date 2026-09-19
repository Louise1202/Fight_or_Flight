-- Lets a station be tagged as a run (like "400m Run") rather than a real
-- exercise - judges see this differently on screen (a clear "running"
-- state instead of "at station"), so it's obvious at a glance whether a
-- team is mid-exercise or just moving between stations.
alter table stations add column if not exists is_run boolean not null default false;
