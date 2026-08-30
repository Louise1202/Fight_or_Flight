import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TeamResults from "@/components/TeamResults";

export const dynamic = "force-dynamic";

export default async function TeamPage({
  params,
}: {
  params: { teamId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: viewer } = await supabase
    .from("team_viewers")
    .select("id, team_id")
    .eq("id", user.id)
    .maybeSingle();
  if (!viewer || viewer.team_id !== params.teamId) redirect("/login?error=no-role");

  const { data: team } = await supabase
    .from("teams")
    .select("id, team_name, athlete_1, athlete_2, start_time, wave")
    .eq("id", params.teamId)
    .maybeSingle();
  if (!team) notFound();

  const [{ data: scans }, { data: penalties }, { data: wave }] = await Promise.all([
    supabase
      .from("scans")
      .select("id, station_number, event_type, scanned_at")
      .eq("team_id", team.id)
      .order("scanned_at", { ascending: true }),
    supabase
      .from("penalties")
      .select("station_number, penalty_seconds, notes")
      .eq("team_id", team.id),
    team.wave != null
      ? supabase
          .from("waves")
          .select("wave_number, scheduled_start, actual_start, actual_end")
          .eq("wave_number", team.wave)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <TeamResults
      team={team}
      initialScans={scans ?? []}
      penalties={penalties ?? []}
      initialWave={wave ?? null}
    />
  );
}
