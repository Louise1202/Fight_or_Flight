import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeStandings, TeamRow } from "@/lib/leaderboard";
import { Scan } from "@/lib/timing";
import { Wave } from "@/lib/waves";

// Always dynamic - this hits the live database on every request and
// must never be statically pre-rendered at build time (a build-time DB
// call against real, ever-changing data is exactly what crashed the
// build once already).
export const dynamic = "force-dynamic";

// Deliberately public - no admin/judge/team login required. This is meant
// to be shown on a projector or spectator's phone. It only ever returns
// team names, divisions, current station, and times - nothing from the
// judges or assignments tables.
export async function GET() {
  const admin = createAdminClient();

  const [{ data: teams }, { data: scans }, { data: penalties }, { data: waves }, { data: stations }] = await Promise.all([
    admin.from("teams").select("id, team_name, division, wave, start_time"),
    admin.from("scans").select("team_id, station_number, event_type, scanned_at"),
    admin.from("penalties").select("team_id, penalty_seconds"),
    admin.from("waves").select("wave_number, scheduled_start, actual_start, actual_end"),
    admin.from("stations").select("number, name, is_run").order("number"),
  ]);

  const scansByTeam: Record<string, Scan[]> = {};
  for (const scan of scans ?? []) {
    (scansByTeam[scan.team_id] ??= []).push(scan);
  }

  const penaltySecondsByTeam: Record<string, number> = {};
  for (const p of penalties ?? []) {
    penaltySecondsByTeam[p.team_id] = (penaltySecondsByTeam[p.team_id] ?? 0) + p.penalty_seconds;
  }

  const wavesByNumber: Record<number, Wave> = {};
  for (const w of waves ?? []) {
    wavesByNumber[w.wave_number] = w as Wave;
  }

  const standings = computeStandings(
    (teams ?? []) as TeamRow[],
    scansByTeam,
    penaltySecondsByTeam,
    wavesByNumber,
    (stations ?? []).map((s: any) => ({ number: s.number, name: s.name, isRun: s.is_run }))
  );

  return NextResponse.json({ standings, generatedAt: new Date().toISOString() });
}
