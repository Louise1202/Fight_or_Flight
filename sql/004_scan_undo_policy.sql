-- Lets a judge delete a scan for a team they're assigned to (used by the
-- "Undo last scan" button on the scan screen, for mis-scans).
create policy "judges delete own team scans"
on scans for delete
using (
  team_id in (select team_id from judge_team_assignments where judge_id = auth.uid())
);
