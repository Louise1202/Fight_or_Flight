import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function normalizeDivision(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (v === "Mens") return "Men";
  if (v === "Womans" || v === "Womens") return "Women";
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
// time-of-day and applies it to the admin-supplied event date.
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

  const form = await req.formData();
  const file = form.get("file");
  const eventDate = form.get("eventDate");

  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (typeof eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return NextResponse.json(
      { error: "A valid event date (YYYY-MM-DD) is required" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    return NextResponse.json({ error: "Couldn't read that file as an Excel workbook" }, { status: 400 });
  }

  const admin = createAdminClient();
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
    const header = (teamsSheet.getRow(1).values as any[]).map((v) =>
      typeof v === "string" ? v.trim() : v
    );
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
      return NextResponse.json(
        { error: "Teams sheet is missing a 'Team ID' column - can't import" },
        { status: 400 }
      );
    }

    const teamRows: any[] = [];
    teamsSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = row.values as any[];
      const id = cellString(values[idCol]);
      if (!id) return;

      teamRows.push({
        id,
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

    if (teamRows.length > 0) {
      const { error } = await admin.from("teams").upsert(teamRows, { onConflict: "id" });
      if (error) return NextResponse.json({ error: `Teams import failed: ${error.message}` }, { status: 500 });
      summary.teamsImported = teamRows.length;
    }
  }

  // --- Waves sheet (schedule only - never touches actual_start/actual_end) ---
  const wavesSheet = workbook.getWorksheet("Waves");
  if (wavesSheet) {
    const header = (wavesSheet.getRow(1).values as any[]).map((v) =>
      typeof v === "string" ? v.trim() : v
    );
    const waveCol = header.indexOf("Wave");
    const startCol = header.indexOf("Scheduled Start");

    if (waveCol !== -1 && startCol !== -1) {
      const waveRows: any[] = [];
      wavesSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const values = row.values as any[];
        const waveNumber = values[waveCol];
        const scheduled = timeOnEventDate(values[startCol], eventDate);
        if (typeof waveNumber === "number" && scheduled) {
          waveRows.push({ wave_number: waveNumber, scheduled_start: scheduled });
        }
      });
      if (waveRows.length > 0) {
        const { error } = await admin.from("waves").upsert(waveRows, { onConflict: "wave_number" });
        if (error) return NextResponse.json({ error: `Waves import failed: ${error.message}` }, { status: 500 });
        summary.wavesImported = waveRows.length;
      }
    }
  }

  // --- Best-effort judge linking by exact name match ---
  const uniqueJudgeNames = [...new Set(Object.values(teamJudgeNames))];
  if (uniqueJudgeNames.length > 0) {
    const { data: existingJudges } = await admin.from("judges").select("id, name");
    const judgeIdByName = new Map(
      (existingJudges ?? []).map((j) => [j.name.trim().toLowerCase(), j.id])
    );

    const assignmentRows: { judge_id: string; team_id: string }[] = [];
    const unmatched = new Set<string>();

    for (const [teamId, judgeName] of Object.entries(teamJudgeNames)) {
      const judgeId = judgeIdByName.get(judgeName.trim().toLowerCase());
      if (judgeId) {
        assignmentRows.push({ judge_id: judgeId, team_id: teamId });
      } else {
        unmatched.add(judgeName);
      }
    }

    if (assignmentRows.length > 0) {
      const { data: existingAssignments } = await admin
        .from("judge_team_assignments")
        .select("judge_id, team_id");
      const existingKeys = new Set(
        (existingAssignments ?? []).map((a) => `${a.judge_id}:${a.team_id}`)
      );
      const newRows = assignmentRows.filter(
        (a) => !existingKeys.has(`${a.judge_id}:${a.team_id}`)
      );
      if (newRows.length > 0) {
        const { error } = await admin.from("judge_team_assignments").insert(newRows);
        if (!error) summary.judgeAssignmentsLinked = newRows.length;
      }
    }

    summary.unmatchedJudgeNames = [...unmatched];
  }

  return NextResponse.json({ ok: true, summary });
}
