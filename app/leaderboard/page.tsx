import { createAdminClient } from "@/lib/supabase/admin";
import { computeStandings, TeamRow } from "@/lib/leaderboard";
import { Scan } from "@/lib/timing";
import { Wave } from "@/lib/waves";
import LeaderboardBoard from "@/components/LeaderboardBoard";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const admin = createAdminClient();

  const [{ data: teams }, { data: scans }, { data: penalties }, { data: waves }] = await Promise.all([
    admin.from("teams").select("id, team_name, division, wave, start_time"),
    admin.from("scans").select("team_id, station_number, event_type, scanned_at"),
    admin.from("penalties").select("team_id, penalty_seconds"),
    admin.from("waves").select("wave_number, scheduled_start, actual_start, actual_end"),
  ]);

  const scansByTeam: Record<string, Scan[]> = {};
  for (const scan of scans ?? []) {
    (scansByTeam[(scan as any).team_id] ??= []).push(scan as any);
  }

  const penaltySecondsByTeam: Record<string, number> = {};
  for (const p of penalties ?? []) {
    penaltySecondsByTeam[p.team_id] = (penaltySecondsByTeam[p.team_id] ?? 0) + p.penalty_seconds;
  }

  const wavesByNumber: Record<number, Wave> = {};
  for (const w of waves ?? []) {
    wavesByNumber[w.wave_number] = w as Wave;
  }

  const initialStandings = computeStandings(
    (teams ?? []) as TeamRow[],
    scansByTeam,
    penaltySecondsByTeam,
    wavesByNumber
  );

  return <LeaderboardBoard initialStandings={initialStandings} />;
}
