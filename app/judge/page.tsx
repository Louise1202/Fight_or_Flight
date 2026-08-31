import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Scan } from "@/lib/timing";
import { Wave } from "@/lib/waves";
import JudgeDashboard from "@/components/JudgeDashboard";

export const dynamic = "force-dynamic";

export default async function JudgeHome() {
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

  const { data: assignments } = await supabase
    .from("judge_team_assignments")
    .select("team_id, teams(id, team_name, athlete_1, athlete_2, start_time, wave)")
    .eq("judge_id", judge.id);

  const teams = (assignments ?? []).map((a: any) => a.teams);
  const teamIds = teams.map((t) => t.id);

  const [{ data: allScans }, { data: waves }] = await Promise.all([
    teamIds.length
      ? supabase
          .from("scans")
          .select("id, team_id, station_number, event_type, scanned_at")
          .in("team_id", teamIds)
          .order("scanned_at", { ascending: true })
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("waves").select("wave_number, scheduled_start, actual_start, actual_end"),
  ]);

  const scansByTeam: Record<string, (Scan & { id: number })[]> = {};
  for (const scan of allScans ?? []) {
    (scansByTeam[scan.team_id] ??= []).push(scan);
  }

  const wavesByNumber: Record<number, Wave> = {};
  for (const w of waves ?? []) {
    wavesByNumber[w.wave_number] = w as Wave;
  }

  return (
    <JudgeDashboard
      judgeName={judge.name}
      judgeId={judge.id}
      teams={teams}
      scansByTeam={scansByTeam}
      wavesByNumber={wavesByNumber}
    />
  );
}
