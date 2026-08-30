alter table teams enable row level security;
alter table judges enable row level security;
alter table team_viewers enable row level security;
alter table judge_team_assignments enable row level security;
alter table scans enable row level security;
alter table penalties enable row level security;

create policy "judges view own row"
on judges for select
using (id = auth.uid());

create policy "team viewers view own row"
on team_viewers for select
using (id = auth.uid());

create policy "judges view own assignments"
on judge_team_assignments for select
using (judge_id = auth.uid());

create policy "team visible to its judge or viewer"
on teams for select
using (
  id in (select team_id from judge_team_assignments where judge_id = auth.uid())
  or id in (select team_id from team_viewers where id = auth.uid())
);

create policy "scans visible to own team"
on scans for select
using (
  team_id in (select team_id from judge_team_assignments where judge_id = auth.uid())
  or team_id in (select team_id from team_viewers where id = auth.uid())
);

create policy "judges insert own team scans"
on scans for insert
with check (
  team_id in (select team_id from judge_team_assignments where judge_id = auth.uid())
);

create policy "penalties visible to own team"
on penalties for select
using (
  team_id in (select team_id from judge_team_assignments where judge_id = auth.uid())
  or team_id in (select team_id from team_viewers where id = auth.uid())
);

create policy "judges insert own team penalties"
on penalties for insert
with check (
  team_id in (select team_id from judge_team_assignments where judge_id = auth.uid())
);
