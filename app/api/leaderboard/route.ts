import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeStandings, TeamRow } from "@/lib/leaderboard";
import { Scan } from "@/lib/timing";

// Deliberately public - no admin/judge/team login required. This is meant
// to be shown on a projector or spectator's phone. It only ever returns
// team names, divisions, current station, and times - nothing from the
// judges or assignments tables.
export async function GET() {
  const admin = createAdminClient();

  const [{ data: teams }, { data: scans }, { data: penalties }] = await Promise.all([
    admin.from("teams").select("id, team_name, division, wave, start_time"),
    admin.from("scans").select("team_id, station_number, event_type, scanned_at"),
    admin.from("penalties").select("team_id, penalty_seconds"),
  ]);

  const scansByTeam: Record<string, Scan[]> = {};
  for (const scan of scans ?? []) {
    (scansByTeam[scan.team_id] ??= []).push(scan);
  }

  const penaltySecondsByTeam: Record<string, number> = {};
  for (const p of penalties ?? []) {
    penaltySecondsByTeam[p.team_id] = (penaltySecondsByTeam[p.team_id] ?? 0) + p.penalty_seconds;
  }

  const standings = computeStandings((teams ?? []) as TeamRow[], scansByTeam, penaltySecondsByTeam);

  return NextResponse.json({ standings, generatedAt: new Date().toISOString() });
}
