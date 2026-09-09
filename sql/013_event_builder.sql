-- Build-the-event-in-the-app feature: teams and heats can now be created,
-- edited and deleted directly in /admin, not just via Excel import.
--
-- Two things change here, both additive/non-destructive - only the
-- options on existing foreign keys are swapped, no data is touched:
--
-- 1. teams.id is the primary key and doubles as a human-facing race
--    number (FF + HHMM + position). Moving a team to a different heat
--    changes its HHMM prefix, so its id has to change too. For that to
--    be safe, every table that references teams(id) needs ON UPDATE
--    CASCADE so the id change follows through automatically.
--
-- 2. ON DELETE CASCADE lets "delete this team" also clear its scans,
--    penalties and judge assignments in one go. team_viewers is still
--    deleted explicitly by the API route first (it needs the row's id to
--    also remove the Supabase Auth user) - the cascade is just a backstop
--    so a team can never be left half-deleted.
--
-- The default constraint names below are what Postgres generates for an
-- inline `references teams(id)` - adjust if your schema was created
-- differently.

alter table scans
  drop constraint scans_team_id_fkey,
  add constraint scans_team_id_fkey
    foreign key (team_id) references teams(id)
    on update cascade on delete cascade;

alter table penalties
  drop constraint penalties_team_id_fkey,
  add constraint penalties_team_id_fkey
    foreign key (team_id) references teams(id)
    on update cascade on delete cascade;

alter table judge_team_assignments
  drop constraint judge_team_assignments_team_id_fkey,
  add constraint judge_team_assignments_team_id_fkey
    foreign key (team_id) references teams(id)
    on update cascade on delete cascade;

alter table team_viewers
  drop constraint team_viewers_team_id_fkey,
  add constraint team_viewers_team_id_fkey
    foreign key (team_id) references teams(id)
    on update cascade on delete cascade;
