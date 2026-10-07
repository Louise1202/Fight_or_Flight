import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getEventById } from "@/lib/activeEvent";
import { brandFor } from "@/lib/events";
import { rankStandings, whereText } from "@/lib/leaderboard";
import { finishNumber, realStationIndex, StationDef } from "@/lib/stations";
import { formatDuration } from "@/lib/timing";
import { isPlausibleEventId, judgeNamesForTeams, loadEventData } from "@/components/results/data";

export const dynamic = "force-dynamic";
// exceljs needs real Node APIs (Buffer, streams) - not edge-compatible.
export const runtime = "nodejs";

const SAST = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function sast(iso: string | null | undefined): string {
  return iso ? SAST.format(new Date(iso)) : "";
}

function slug(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "event";
}

/** "3: Sled Push", "FINISH", or the raw number for anything unknown (e.g. a run). */
function stationText(stations: StationDef[], num: number | null): string | number {
  if (num == null) return "";
  if (num === finishNumber(stations)) return "FINISH";
  const st = stations.find((s) => s.number === num);
  if (!st) return num;
  if (st.isRun) return st.name;
  return `${realStationIndex(stations, num)}: ${st.name}`;
}

const STATUS_TEXT = {
  finished: "Finished",
  in_progress: "On course",
  stopped: "Stopped",
  not_started: "Not started",
} as const;

// Full audit export of one event (admin only). Never contains medical
// answers or athlete contact details - only what the teams table holds.
export async function GET(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const requested = req.nextUrl.searchParams.get("eventId");

  let event;
  let data;
  let judges;
  try {
    if (requested != null) {
      if (!isPlausibleEventId(requested)) return NextResponse.json({ error: "Unknown event" }, { status: 404 });
      event = await getEventById(requested, admin);
      if (!event) return NextResponse.json({ error: "Unknown event" }, { status: 404 });
    } else {
      event = await getActiveEvent(admin);
    }
    data = await loadEventData(event, admin);
    judges = await judgeNamesForTeams(admin, data.teams.map((t) => t.id));
  } catch {
    return NextResponse.json({ error: "The export couldn't be built right now - please try again." }, { status: 500 });
  }

  const { teams, waves, stations, scans, penalties, standings } = data;
  const brand = brandFor(event);
  const judgeName = (id: string | null) => (id ? judges.nameById.get(id) ?? "Unknown" : "");

  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${event.name} Race Timing`;
  workbook.created = new Date();

  const headerStyle = (sheet: ExcelJS.Worksheet) => {
    const row = sheet.getRow(1);
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: brand.excel.dark } };
    });
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  };

  // --- Results sheet ---
  const resultsSheet = workbook.addWorksheet("Results");
  resultsSheet.columns = [
    { header: "Overall Rank", key: "overall", width: 12 },
    { header: "Division Rank", key: "divRank", width: 13 },
    { header: "Team ID", key: "id", width: 12 },
    { header: "Team Name", key: "name", width: 24 },
    { header: "Division", key: "division", width: 12 },
    { header: "Heat", key: "heat", width: 8 },
    { header: "Status", key: "status", width: 13 },
    { header: "Stopped After Station", key: "stoppedAfter", width: 20 },
    { header: "Where Stopped", key: "where", width: 32 },
    { header: "Stopped Note", key: "note", width: 40 },
    { header: "Raw Time", key: "raw", width: 12 },
    { header: "Penalties (s)", key: "penalty", width: 13 },
    { header: "Official Time", key: "official", width: 14 },
  ];
  for (const s of rankStandings(standings)) {
    const stopped = s.status === "stopped";
    resultsSheet.addRow({
      overall: s.overallRank ?? "",
      divRank: s.divisionRank ?? "",
      id: s.team.id,
      name: s.team.team_name,
      division: s.team.division ?? "",
      heat: s.team.wave ?? "",
      status: STATUS_TEXT[s.status],
      stoppedAfter: stopped ? s.completedStations : "",
      where: stopped || s.status === "in_progress" ? whereText(s) : "",
      note: stopped ? s.stoppedNote ?? "" : "",
      raw: s.rawMs != null ? formatDuration(s.rawMs) : "",
      penalty: s.penaltySeconds || "",
      official: s.finalMs != null ? formatDuration(s.finalMs) : "",
    });
  }
  headerStyle(resultsSheet);

  // --- Teams sheet (every team, including withdrawn) ---
  const teamsSheet = workbook.addWorksheet("Teams");
  teamsSheet.columns = [
    { header: "Team ID", key: "id", width: 12 },
    { header: "Team Name", key: "team_name", width: 24 },
    { header: "Athlete 1", key: "athlete_1", width: 20 },
    { header: "Athlete 2", key: "athlete_2", width: 20 },
    { header: "Division", key: "division", width: 12 },
    { header: "Heat", key: "wave", width: 8 },
    { header: "Status", key: "status", width: 12 },
    { header: "Paid", key: "paid", width: 8 },
    { header: "Judge(s)", key: "judges", width: 24 },
  ];
  for (const t of teams) {
    teamsSheet.addRow({
      id: t.id,
      team_name: t.team_name,
      athlete_1: t.athlete_1 ?? "",
      athlete_2: t.athlete_2 ?? "",
      division: t.division ?? "",
      wave: t.wave ?? "",
      status: t.status ?? "",
      paid: t.paid ? "Yes" : "No",
      judges: (judges.byTeam.get(t.id) ?? []).join(", "),
    });
  }
  headerStyle(teamsSheet);

  // --- Scans sheet (raw log - the audit trail) ---
  const scansSheet = workbook.addWorksheet("Scans");
  scansSheet.columns = [
    { header: "Team ID", key: "team_id", width: 12 },
    { header: "Station", key: "station", width: 26 },
    { header: "Event", key: "event_type", width: 10 },
    { header: "Time (SAST)", key: "local", width: 22 },
    { header: "Timestamp (UTC)", key: "scanned_at", width: 28 },
    { header: "Judge", key: "judge_name", width: 20 },
  ];
  for (const s of scans) {
    scansSheet.addRow({
      team_id: s.team_id,
      station: stationText(stations, s.station_number),
      event_type: s.event_type,
      local: sast(s.scanned_at),
      scanned_at: s.scanned_at,
      judge_name: judgeName(s.judge_id),
    });
  }
  headerStyle(scansSheet);

  // --- Penalties sheet ---
  const penaltiesSheet = workbook.addWorksheet("Penalties");
  penaltiesSheet.columns = [
    { header: "Team ID", key: "team_id", width: 12 },
    { header: "Station", key: "station", width: 26 },
    { header: "Penalty (seconds)", key: "penalty_seconds", width: 16 },
    { header: "Judge", key: "judge_name", width: 20 },
    { header: "Notes", key: "notes", width: 30 },
    { header: "Time (SAST)", key: "local", width: 22 },
  ];
  for (const p of penalties) {
    penaltiesSheet.addRow({
      team_id: p.team_id,
      station: stationText(stations, p.station_number),
      penalty_seconds: p.penalty_seconds,
      judge_name: judgeName(p.judge_id),
      notes: p.notes ?? "",
      local: sast(p.created_at),
    });
  }
  headerStyle(penaltiesSheet);

  // --- Heats sheet ---
  const wavesSheet = workbook.addWorksheet("Heats");
  wavesSheet.columns = [
    { header: "Heat", key: "wave_number", width: 8 },
    { header: "Scheduled Start", key: "scheduled_start", width: 24 },
    { header: "Actual Start (SAST)", key: "actual_start", width: 22 },
    { header: "Actual End (SAST)", key: "actual_end", width: 22 },
    { header: "End Reason", key: "end_reason", width: 14 },
  ];
  for (const w of waves) {
    wavesSheet.addRow({
      wave_number: w.wave_number,
      scheduled_start: w.scheduled_start,
      actual_start: w.actual_start ? sast(w.actual_start) : "(not started)",
      actual_end: w.actual_end ? sast(w.actual_end) : w.actual_start ? "(in progress)" : "",
      end_reason: w.end_reason ?? "",
    });
  }
  headerStyle(wavesSheet);

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${slug(event.name)}-${event.event_date}-results.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
