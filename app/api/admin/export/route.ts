import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeStandings, TeamRow } from "@/lib/leaderboard";
import { formatDuration, Scan } from "@/lib/timing";

// exceljs needs real Node APIs (Buffer, streams) - not edge-compatible.
export const runtime = "nodejs";

export async function GET() {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const [{ data: teams }, { data: scans }, { data: penalties }, { data: judges }, { data: assignments }, { data: waves }] =
    await Promise.all([
      admin.from("teams").select("*").order("id"),
      admin.from("scans").select("*").order("scanned_at"),
      admin.from("penalties").select("*").order("created_at"),
      admin.from("judges").select("id, name"),
      admin.from("judge_team_assignments").select("judge_id, team_id"),
      admin.from("waves").select("wave_number, scheduled_start, actual_start, actual_end"),
    ]);

  const judgeNameById = new Map((judges ?? []).map((j) => [j.id, j.name]));
  const judgeNamesByTeam = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const name = judgeNameById.get(a.judge_id) ?? a.judge_id;
    const list = judgeNamesByTeam.get(a.team_id) ?? [];
    list.push(name);
    judgeNamesByTeam.set(a.team_id, list);
  }

  const scansByTeam: Record<string, Scan[]> = {};
  for (const scan of scans ?? []) {
    (scansByTeam[scan.team_id] ??= []).push(scan);
  }
  const penaltySecondsByTeam: Record<string, number> = {};
  for (const p of penalties ?? []) {
    penaltySecondsByTeam[p.team_id] = (penaltySecondsByTeam[p.team_id] ?? 0) + p.penalty_seconds;
  }

  const wavesByNumber: Record<number, import("@/lib/waves").Wave> = {};
  for (const w of waves ?? []) {
    wavesByNumber[w.wave_number] = w as any;
  }

  const standings = computeStandings(
    (teams ?? []) as TeamRow[],
    scansByTeam,
    penaltySecondsByTeam,
    wavesByNumber
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Fight or Flight Race Timing";
  workbook.created = new Date();

  // --- Results sheet ---
  const resultsSheet = workbook.addWorksheet("Results");
  resultsSheet.columns = [
    { header: "Rank", key: "rank", width: 8 },
    { header: "Team ID", key: "id", width: 12 },
    { header: "Team Name", key: "name", width: 20 },
    { header: "Division", key: "division", width: 12 },
    { header: "Status", key: "status", width: 14 },
    { header: "Current Station", key: "station", width: 20 },
    { header: "Official Time", key: "time", width: 14 },
  ];
  let finishedRank = 1;
  for (const s of standings) {
    resultsSheet.addRow({
      rank: s.status === "finished" ? finishedRank++ : "",
      id: s.team.id,
      name: s.team.team_name,
      division: s.team.division ?? "",
      status: s.status.replace("_", " "),
      station: s.status === "in_progress" ? s.currentStationLabel : "",
      time: s.finalMs != null ? formatDuration(s.finalMs) : "",
    });
  }
  resultsSheet.getRow(1).font = { bold: true };

  // --- Teams sheet ---
  const teamsSheet = workbook.addWorksheet("Teams");
  teamsSheet.columns = [
    { header: "Team ID", key: "id", width: 12 },
    { header: "Team Name", key: "team_name", width: 20 },
    { header: "Athlete 1", key: "athlete_1", width: 20 },
    { header: "Athlete 2", key: "athlete_2", width: 20 },
    { header: "Division", key: "division", width: 12 },
    { header: "Heat", key: "wave", width: 8 },
    { header: "Start Time", key: "start_time", width: 22 },
    { header: "Judge(s)", key: "judges", width: 24 },
  ];
  for (const t of teams ?? []) {
    teamsSheet.addRow({
      ...t,
      judges: (judgeNamesByTeam.get(t.id) ?? []).join(", "),
    });
  }
  teamsSheet.getRow(1).font = { bold: true };

  // --- Scans sheet (raw log - the audit trail) ---
  const scansSheet = workbook.addWorksheet("Scans");
  scansSheet.columns = [
    { header: "Team ID", key: "team_id", width: 12 },
    { header: "Station", key: "station_number", width: 10 },
    { header: "Event", key: "event_type", width: 10 },
    { header: "Timestamp", key: "scanned_at", width: 26 },
    { header: "Judge", key: "judge_name", width: 20 },
  ];
  for (const s of scans ?? []) {
    scansSheet.addRow({
      team_id: s.team_id,
      station_number: s.station_number === 13 ? "FINISH" : s.station_number,
      event_type: s.event_type,
      scanned_at: s.scanned_at,
      judge_name: judgeNameById.get(s.judge_id) ?? s.judge_id,
    });
  }
  scansSheet.getRow(1).font = { bold: true };

  // --- Penalties sheet ---
  const penaltiesSheet = workbook.addWorksheet("Penalties");
  penaltiesSheet.columns = [
    { header: "Team ID", key: "team_id", width: 12 },
    { header: "Station", key: "station_number", width: 10 },
    { header: "Penalty (seconds)", key: "penalty_seconds", width: 16 },
    { header: "Judge", key: "judge_name", width: 20 },
    { header: "Notes", key: "notes", width: 30 },
    { header: "Timestamp", key: "created_at", width: 26 },
  ];
  for (const p of penalties ?? []) {
    penaltiesSheet.addRow({
      team_id: p.team_id,
      station_number: p.station_number,
      penalty_seconds: p.penalty_seconds,
      judge_name: judgeNameById.get(p.judge_id) ?? p.judge_id,
      notes: p.notes ?? "",
      created_at: p.created_at,
    });
  }
  penaltiesSheet.getRow(1).font = { bold: true };

  // --- Heats sheet (scheduled vs actual start/end) ---
  const wavesSheet = workbook.addWorksheet("Heats");
  wavesSheet.columns = [
    { header: "Heat", key: "wave_number", width: 8 },
    { header: "Scheduled Start", key: "scheduled_start", width: 24 },
    { header: "Actual Start", key: "actual_start", width: 24 },
    { header: "Actual End", key: "actual_end", width: 24 },
  ];
  for (const w of waves ?? []) {
    wavesSheet.addRow({
      wave_number: w.wave_number,
      scheduled_start: w.scheduled_start,
      actual_start: w.actual_start ?? "(not started)",
      actual_end: w.actual_end ?? (w.actual_start ? "(in progress)" : ""),
    });
  }
  wavesSheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `fight-or-flight-export-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
