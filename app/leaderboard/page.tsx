import { createAdminClient } from "@/lib/supabase/admin";
import { computeStandings, TeamRow } from "@/lib/leaderboard";
import { Scan } from "@/lib/timing";
import LeaderboardBoard from "@/components/LeaderboardBoard";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const admin = createAdminClient();

  const [{ data: teams }, { data: scans }, { data: penalties }] = await Promise.all([
    admin.from("teams").select("id, team_name, division, wave, start_time"),
    admin.from("scans").select("team_id, station_number, event_type, scanned_at"),
    admin.from("penalties").select("team_id, penalty_seconds"),
  ]);

  const scansByTeam: Record<string, Scan[]> = {};
  for (const scan of scans ?? []) {
    (scansByTeam[(scan as any).team_id] ??= []).push(scan as any);
  }

  const penaltySecondsByTeam: Record<string, number> = {};
  for (const p of penalties ?? []) {
    penaltySecondsByTeam[p.team_id] = (penaltySecondsByTeam[p.team_id] ?? 0) + p.penalty_seconds;
  }

  const initialStandings = computeStandings(
    (teams ?? []) as TeamRow[],
    scansByTeam,
    penaltySecondsByTeam
  );

  return <LeaderboardBoard initialStandings={initialStandings} />;
}
