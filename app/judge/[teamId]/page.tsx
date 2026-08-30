import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ScanScreen from "@/components/ScanScreen";

export const dynamic = "force-dynamic";

export default async function JudgeScanPage({
  params,
}: {
  params: { teamId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: judge } = await supabase
    .from("judges")
    .select("id, name")
    .eq("id", user.id)
    .maybeSingle();
  if (!judge) redirect("/login?error=no-role");

  // RLS already restricts this to teams the judge is assigned to -
  // a null result means either the team doesn't exist or isn't theirs.
  const { data: team } = await supabase
    .from("teams")
    .select("id, team_name, athlete_1, athlete_2, start_time, wave")
    .eq("id", params.teamId)
    .maybeSingle();
  if (!team) notFound();

  const [{ data: scans }, { data: wave }] = await Promise.all([
    supabase
      .from("scans")
      .select("id, station_number, event_type, scanned_at")
      .eq("team_id", team.id)
      .order("scanned_at", { ascending: true }),
    team.wave != null
      ? supabase
          .from("waves")
          .select("wave_number, scheduled_start, actual_start, actual_end")
          .eq("wave_number", team.wave)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <ScanScreen
      team={team}
      judgeId={judge.id}
      initialScans={scans ?? []}
      initialWave={wave ?? null}
    />
  );
}
