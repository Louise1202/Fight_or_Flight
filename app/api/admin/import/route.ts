import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent } from "@/lib/activeEvent";
import { friendlyDbError } from "@/lib/events";
import { chunk } from "@/lib/fetchAll";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Legacy one-shot roster import (hidden in the UI). Only ever touches the
// ACTIVE event, and only an unlocked 'heat_position' event: a 'sequential'
// event's Team IDs are permanent and come from registration instead.

function normalizeDivision(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (v === "Mens" || v.toLowerCase() === "boys") return "Men";
  if (v === "Womans" || v === "Womens" || v.toLowerCase() === "ladies" || v.toLowerCase() === "girls") return "Women";
  if (v === "TBC" || v === "") return null;
  return v;
}

function cellString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" || s === "TBC" ? null : s;
}

// Excel time-of-day cells come through as a JS Date on an 1899-era epoch
// with only the hours/minutes meaningful - this pulls just that
// time-of-day and applies it to the event date.
function timeOnEventDate(cell: unknown, eventDate: string): string | null {
  if (!(cell instanceof Date)) return null;
  const hh = String(cell.getUTCHours()).padStart(2, "0");
  const mm = String(cell.getUTCMinutes()).padStart(2, "0");
  return `${eventDate}T${hh}:${mm}:00`;
}

export async function POST(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  let event;
  try {
    event = await getActiveEvent(admin);
  } catch {
    return NextResponse.json({ error: "No active event is set." }, { status: 500 });
  }
  if (event.locked) {
    return NextResponse.json({ error: friendlyDbError("RT001", "This event is locked.") }, { status: 409 });
  }
  if (event.team_id_scheme === "sequential") {
    return NextResponse.json(
      {
        error: `${event.name} uses permanent Team IDs - add or correct teams with the Event report instead of this import.`,
      },
      { status: 409 }
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  const eventDateField = form.get("eventDate");

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  const eventDate =
    typeof eventDateField === "string" && /^\d{4}-\d{2}-\d{2}$/.test(eventDateField) ? eventDateField : event.event_date;

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    return NextResponse.json({ error: "Couldn't read that file as an Excel workbook" }, { status: 400 });
  }

  const summary = {
    teamsImported: 0,
    wavesImported: 0,
    judgeAssignmentsLinked: 0,
    unmatchedJudgeNames: [] as string[],
  };

  // --- Teams sheet ---
  const teamsSheet = workbook.getWorksheet("Teams");
  const teamJudgeNames: Record<string, string> = {};

  if (teamsSheet) {
    const header = (teamsSheet.getRow(1).values as any[]).map((v) => (typeof v === "string" ? v.trim() : v));
    const col = (name: string) => header.indexOf(name);

    const idCol = col("Team ID");
    const nameCol = col("Team Name");
    const a1Col = col("Athlete 1");
    const a2Col = col("Athlete 2");
    const divCol = col("Division");
    const heatCol = col("Heat");
    const startCol = col("Start Time");
    const judgeCol = col("Judges");

    if (idCol === -1) {
      return NextResponse.json({ error: "Teams sheet is missing a 'Team ID' column - can't import" }, { status: 400 });
    }

    const teamRows: Record<string, unknown>[] = [];
    teamsSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = row.values as any[];
      const id = cellString(values[idCol]);
      if (!id) return;

      teamRows.push({
        id,
        event_id: event.id,
        team_name: cellString(values[nameCol]) ?? id,
        athlete_1: cellString(values[a1Col]),
        athlete_2: cellString(values[a2Col]),
        division: normalizeDivision(cellString(values[divCol])),
        wave: typeof values[heatCol] === "number" ? values[heatCol] : null,
        start_time: timeOnEventDate(values[startCol], eventDate) ?? `${eventDate}T07:30:00`,
      });

      const judgeName = cellString(values[judgeCol]);
      if (judgeName) teamJudgeNames[id] = judgeName;
    });

    // Never let an upsert grab a team that belongs to another event.
    const foreign = new Set<string>();
    for (const ids of chunk(teamRows.map((r) => r.id as string))) {
      const { data, error } = await admin.from("teams").select("id").in("id", ids).neq("event_id", event.id);
      if (error) return NextResponse.json({ error: "Teams import failed - please try again." }, { status: 500 });
      for (const t of data ?? []) foreign.add(t.id);
    }
    const ownRows = teamRows.filter((r) => !foreign.has(r.id as string));
    for (const id of foreign) delete teamJudgeNames[id];

    if (ownRows.length > 0) {
      const { error } = await admin.from("teams").upsert(ownRows, { onConflict: "id" });
      if (error) {
        return NextResponse.json(
          { error: `Teams import failed: ${friendlyDbError(error.code, "the database refused the rows.")}` },
          { status: error.code === "RT001" ? 409 : 500 }
        );
      }
      summary.teamsImported = ownRows.length;
    }
  }

  // --- Waves sheet (schedule only - never touches actual_start/actual_end) ---
  const wavesSheet = workbook.getWorksheet("Waves");
  if (wavesSheet) {
    const header = (wavesSheet.getRow(1).values as any[]).map((v) => (typeof v === "string" ? v.trim() : v));
    const waveCol = header.indexOf("Wave");
    const startCol = header.indexOf("Scheduled Start");

    if (waveCol !== -1 && startCol !== -1) {
      const waveRows: { event_id: string; wave_number: number; scheduled_start: string }[] = [];
      wavesSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const values = row.values as any[];
        const waveNumber = values[waveCol];
        const scheduled = timeOnEventDate(values[startCol], eventDate);
        if (typeof waveNumber === "number" && scheduled) {
          waveRows.push({ event_id: event.id, wave_number: waveNumber, scheduled_start: scheduled });
        }
      });
      if (waveRows.length > 0) {
        const { error } = await admin.from("waves").upsert(waveRows, { onConflict: "event_id,wave_number" });
        if (error) {
          return NextResponse.json(
            { error: `Heats import failed: ${friendlyDbError(error.code, "the database refused the rows.")}` },
            { status: 500 }
          );
        }
        summary.wavesImported = waveRows.length;
      }
    }
  }

  // --- Best-effort judge linking by exact name match ---
  const uniqueJudgeNames = [...new Set(Object.values(teamJudgeNames))];
  if (uniqueJudgeNames.length > 0) {
    const { data: existingJudges } = await admin.from("judges").select("id, name");
    const judgeIdByName = new Map((existingJudges ?? []).map((j) => [String(j.name ?? "").trim().toLowerCase(), j.id]));

    const assignmentRows: { judge_id: string; team_id: string }[] = [];
    const unmatched = new Set<string>();
    for (const [teamId, judgeName] of Object.entries(teamJudgeNames)) {
      const judgeId = judgeIdByName.get(judgeName.trim().toLowerCase());
      if (judgeId) assignmentRows.push({ judge_id: judgeId, team_id: teamId });
      else unmatched.add(judgeName);
    }

    if (assignmentRows.length > 0) {
      const existingKeys = new Set<string>();
      for (const ids of chunk([...new Set(assignmentRows.map((a) => a.team_id))])) {
        const { data } = await admin.from("judge_team_assignments").select("judge_id, team_id").in("team_id", ids);
        for (const a of data ?? []) existingKeys.add(`${a.judge_id}:${a.team_id}`);
      }
      const newRows = assignmentRows.filter((a) => !existingKeys.has(`${a.judge_id}:${a.team_id}`));
      if (newRows.length > 0) {
        const { error } = await admin.from("judge_team_assignments").insert(newRows);
        if (!error) summary.judgeAssignmentsLinked = newRows.length;
      }
    }

    summary.unmatchedJudgeNames = [...unmatched];
  }

  return NextResponse.json({ ok: true, summary });
}
