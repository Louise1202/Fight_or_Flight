import { NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeStandings, TeamRow } from "@/lib/leaderboard";
import { Scan } from "@/lib/timing";
import { Wave } from "@/lib/waves";

export async function GET() {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const [{ data: teams }, { data: scans }, { data: penalties }, { data: judges }, { data: assignments }, { data: waves }] =
    await Promise.all([
      admin.from("teams").select("id, team_name, division, wave, start_time"),
      admin.from("scans").select("team_id, station_number, event_type, scanned_at"),
      admin.from("penalties").select("team_id, penalty_seconds"),
      admin.from("judges").select("id, name"),
      admin.from("judge_team_assignments").select("judge_id, team_id"),
      admin.from("waves").select("wave_number, scheduled_start, actual_start, actual_end"),
    ]);

  const judgeNameById = new Map((judges ?? []).map((j) => [j.id, j.name]));
  const judgeNamesByTeam = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const name = judgeNameById.get(a.judge_id) ?? "Unknown";
    const list = judgeNamesByTeam.get(a.team_id) ?? [];
    list.push(name);
    judgeNamesByTeam.set(a.team_id, list);
  }

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

  const standings = computeStandings(
    (teams ?? []) as TeamRow[],
    scansByTeam,
    penaltySecondsByTeam,
    wavesByNumber
  );

  const enriched = standings.map((s) => ({
    ...s,
    judgeNames: judgeNamesByTeam.get(s.team.id) ?? [],
  }));

  const counts = {
    finished: enriched.filter((s) => s.status === "finished").length,
    inProgress: enriched.filter((s) => s.status === "in_progress").length,
    notStarted: enriched.filter((s) => s.status === "not_started").length,
    total: enriched.length,
  };

  return NextResponse.json({
    standings: enriched,
    counts,
    waves: waves ?? [],
    generatedAt: new Date().toISOString(),
  });
}
