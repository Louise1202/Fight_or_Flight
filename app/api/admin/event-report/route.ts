import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { heatIdPrefix, nextTeamId, positionOf, renameForPosition } from "@/lib/teamId";
import { autoFixTeamIds } from "@/lib/rebuildTeamIds";

// Always dynamic - this hits the live database on every request and
// must never be statically pre-rendered at build time (a build-time DB
// call against real, ever-changing data is exactly what crashed the
// build once already).
export const dynamic = "force-dynamic";

// The "build/correct the event" report - a separate, editable round-trip
// from the read-only /api/admin/export audit dump. This is meant to be
// downloaded, edited by hand (add a row, change a Heat number, tick
// Delete?), and re-uploaded here, and it applies exactly the same rules
// the in-app "Add team" / "Add heat" / move-heat UI already uses - it's
// a bulk version of those, not a second, looser way to do the same thing.
export const runtime = "nodejs";

function cellString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function cellNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isTruthy(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "x" || s === "1" || s === "delete";
}

// Accepts either an Excel time-of-day cell (comes through as a JS Date on
// an 1899-era epoch) or a plain typed string like "9:30" / "09:30".
function parseTimeCell(v: unknown): string | null {
  if (v instanceof Date) {
    const hh = String(v.getUTCHours()).padStart(2, "0");
    const mm = String(v.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  const s = cellString(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function normalizeDivision(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (v === "Mens" || v.toLowerCase() === "boys") return "Men";
  if (v === "Womans" || v === "Womens" || v.toLowerCase() === "ladies" || v.toLowerCase() === "girls") return "Women";
  if (v === "TBC" || v === "") return null;
  return v;
}

export async function GET(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const blank = req.nextUrl.searchParams.get("blank") === "1";

  const admin = createAdminClient();
  const [{ data: teams }, { data: waves }, { data: stations }, { data: assignments }, { data: judges }] = blank
    ? [{ data: [] as any[] }, { data: [] as any[] }, { data: [] as any[] }, { data: [] as any[] }, { data: [] as any[] }]
    : await Promise.all([
        admin.from("teams").select("id, team_name, athlete_1, athlete_2, division, wave").order("wave").order("id"),
        admin.from("waves").select("wave_number, scheduled_start").order("wave_number"),
        admin.from("stations").select("number, name").order("number"),
        admin.from("judge_team_assignments").select("judge_id, team_id"),
        admin.from("judges").select("id, name"),
      ]);

  const judgeNameById = new Map((judges ?? []).map((j) => [j.id, j.name]));
  const judgeNamesByTeamId = new Map<string, string[]>();
  for (const a of assignments ?? []) {
    const name = judgeNameById.get(a.judge_id);
    if (!name) continue;
    const list = judgeNamesByTeamId.get(a.team_id) ?? [];
    list.push(name);
    judgeNamesByTeamId.set(a.team_id, list);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Fight or Flight Race Timing";
  workbook.created = new Date();

  const instructions = workbook.addWorksheet("Instructions");
  instructions.columns = [{ width: 100 }];
  [
    "HOW TO USE THIS REPORT",
    "",
    blank
      ? "This is a BLANK template for building a new event from scratch. Fill in"
      : "This is the current event - every station, heat, and team. Edit it and",
    blank
      ? "the sheets below (stations first, then heats, then teams), then upload it"
      : "re-upload it on the Event Report card in /admin to apply your corrections.",
    blank ? "on the Event Report card in /admin." : "",
    "",
    "STATIONS SHEET - fill this in first",
    "- Put the course in order, one row per station, top to bottom.",
    "- To ADD a station: add a new row at the BOTTOM, leave the Station number",
    "  blank, just type its Name. Stations can only be added at the end.",
    "- To RENAME a station: change its Name, leave everything else as is.",
    "- The Is Run? column marks a station as a run (like \"400m Run\") rather",
    "  than a real exercise - judges see a clearly different \"running\"",
    "  display for these. Leave it blank for a normal exercise station.",
    "- To DELETE a station: put anything in its Delete? column. Only works for",
    "  the LAST station, and only if no team has scanned there yet.",
    "- The finish line is automatic - one past your last station. Don't add it",
    "  as a row yourself.",
    "",
    "HEATS SHEET",
    "- To CHANGE a heat's time: edit its Scheduled Time, leave Heat as is.",
    "- To ADD a new heat: add a new row, leave Heat blank, fill in a time.",
    "- To DELETE a heat: put anything in its Delete? column. Only works for a",
    "  heat with no teams in it that hasn't been started yet.",
    "",
    "TEAMS SHEET - do this last, once your heats exist",
    "- To EDIT a team: change any of its cells except Team ID, then re-upload.",
    "- To MOVE a team to a different heat: change its Heat number. Its Team ID",
    "  will be regenerated automatically to match the new heat (FF + heat time +",
    "  position) - don't try to type a new ID yourself.",
    "- To ADD a new team: add a new row, leave Team ID blank, fill in the rest,",
    "  and put the Heat number it belongs in.",
    "- To DELETE a team: put anything (e.g. \"x\") in its Delete? column.",
    "- A team that already has scans recorded can't be moved to a different",
    "  heat - the upload will report that row as an error instead of moving it.",
    "- The Judge column sets which judge is assigned to that team - type a",
    "  judge's name exactly as it appears in /admin. Leave it blank to leave",
    "  the team's current judge assignment untouched; a name that doesn't",
    "  match any existing judge is reported as an error for that row.",
    "",
    "Nothing here ever touches race-day timing (actual start/end times,",
    "scans, penalties) - only the course, the roster, and the schedule.",
  ]
    .filter((line) => line !== "")
    .forEach((line) => instructions.addRow([line]));
  instructions.getRow(1).font = { bold: true, size: 14 };

  const stationsSheet = workbook.addWorksheet("Stations");
  stationsSheet.columns = [
    { header: "Station (do not edit)", key: "number", width: 20 },
    { header: "Name", key: "name", width: 28 },
    { header: "Is Run?", key: "is_run", width: 10 },
    { header: "Delete?", key: "delete", width: 10 },
  ];
  for (const s of (stations ?? []) as any[]) {
    stationsSheet.addRow({ number: s.number, name: s.name, is_run: s.is_run ? "TRUE" : "", delete: "" });
  }
  stationsSheet.getRow(1).font = { bold: true };

  const teamsSheet = workbook.addWorksheet("Teams");
  teamsSheet.columns = [
    { header: "Team ID (do not edit)", key: "id", width: 20 },
    { header: "Team Name", key: "team_name", width: 20 },
    { header: "Athlete 1", key: "athlete_1", width: 20 },
    { header: "Athlete 2", key: "athlete_2", width: 20 },
    { header: "Division", key: "division", width: 12 },
    { header: "Heat", key: "wave", width: 8 },
    { header: "Judge", key: "judge", width: 20 },
    { header: "Delete?", key: "delete", width: 10 },
  ];
  for (const t of teams ?? []) {
    teamsSheet.addRow({
      ...t,
      judge: (judgeNamesByTeamId.get(t.id) ?? []).join(", "),
      delete: "",
    });
  }
  teamsSheet.getRow(1).font = { bold: true };

  const heatsSheet = workbook.addWorksheet("Heats");
  heatsSheet.columns = [
    { header: "Heat (do not edit)", key: "wave_number", width: 18 },
    { header: "Scheduled Time (HH:MM)", key: "time", width: 22 },
    { header: "Delete?", key: "delete", width: 10 },
  ];
  for (const w of waves ?? []) {
    const start = new Date(w.scheduled_start);
    const hh = String(start.getUTCHours()).padStart(2, "0");
    const mm = String(start.getUTCMinutes()).padStart(2, "0");
    heatsSheet.addRow({ wave_number: w.wave_number, time: `${hh}:${mm}`, delete: "" });
  }
  heatsSheet.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = blank
    ? "fight-or-flight-new-event-template.xlsx"
    : `fight-or-flight-event-report-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// Applies an edited copy of the report above: adds/edits/deletes heats,
// then teams (in that order, since a team row might reference a heat
// added earlier in the SAME upload). Every row is independent - one bad
// row is reported and skipped, it never aborts the rest of the file.
export async function POST(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    return NextResponse.json({ error: "Couldn't read that file as an Excel workbook" }, { status: 400 });
  }

  const admin = createAdminClient();
  const errors: string[] = [];
  const summary = {
    stationsAdded: 0,
    stationsUpdated: 0,
    stationsDeleted: 0,
    heatsAdded: 0,
    heatsUpdated: 0,
    heatsDeleted: 0,
    teamsAdded: 0,
    teamsUpdated: 0,
    teamsDeleted: 0,
  };

  // -------------------------------------------------------------- Stations
  const { data: existingStations, error: stationsFetchErr } = await admin
    .from("stations")
    .select("number, name")
    .order("number");
  if (stationsFetchErr) return NextResponse.json({ error: stationsFetchErr.message }, { status: 500 });

  const stationByNumber = new Map((existingStations ?? []).map((s) => [s.number, s.name]));
  let maxStationNumber = (existingStations ?? []).reduce((m, s) => Math.max(m, s.number), 0);

  const stationsSheet = workbook.getWorksheet("Stations");
  if (stationsSheet) {
    const header = (stationsSheet.getRow(1).values as any[]).map((v) => (typeof v === "string" ? v.trim() : v));
    const col = (name: string) => header.indexOf(name);
    const numCol = col("Station (do not edit)");
    const nameCol = col("Name");
    const isRunCol = col("Is Run?");
    const deleteCol = col("Delete?");

    if (numCol === -1 || nameCol === -1) {
      return NextResponse.json(
        { error: "Stations sheet is missing an expected column - please use the downloaded template as-is" },
        { status: 400 }
      );
    }

    // Need to know which stations already have scans, to guard deletes -
    // same rule as the single-station API route.
    const { data: scanStationRows, error: scanStationErr } = await admin.from("scans").select("station_number");
    if (scanStationErr) return NextResponse.json({ error: scanStationErr.message }, { status: 500 });
    const stationsWithScans = new Set((scanStationRows ?? []).map((s) => s.station_number));

    let rowNumber = 1;
    for (const row of stationsSheet.getRows(2, stationsSheet.rowCount - 1) ?? []) {
      rowNumber++;
      const values = row.values as any[];
      const num = cellNumber(values[numCol]);
      const name = cellString(values[nameCol]);
      const isRunProvided = isRunCol !== -1;
      const isRunValue = isRunProvided ? isTruthy(values[isRunCol]) : false;
      const del = isTruthy(values[deleteCol]);
      if (num == null && !name) continue; // fully blank row

      if (num == null) {
        // ADD a station - always appended at the end. A brand new
        // station has nothing to preserve, so an absent column just
        // defaults to "not a run".
        if (!name) {
          errors.push(`Stations row ${rowNumber}: a name is required to add a station`);
          continue;
        }
        const newNumber = maxStationNumber + 1;
        const { error } = await admin
          .from("stations")
          .insert({ number: newNumber, name, is_run: isRunValue });
        if (error) {
          errors.push(`Stations row ${rowNumber}: ${error.message}`);
          continue;
        }
        stationByNumber.set(newNumber, name);
        maxStationNumber = newNumber;
        summary.stationsAdded++;
        continue;
      }

      if (!stationByNumber.has(num)) {
        errors.push(`Stations row ${rowNumber}: station ${num} doesn't exist - leave the Station number blank to add a new one instead`);
        continue;
      }

      if (del) {
        if (num !== maxStationNumber) {
          errors.push(`Stations row ${rowNumber}: only the last station can be deleted - remove them from the end, one at a time`);
          continue;
        }
        if (stationsWithScans.has(num)) {
          errors.push(`Stations row ${rowNumber}: teams have already scanned at station ${num} - it can't be removed`);
          continue;
        }
        const { error } = await admin.from("stations").delete().eq("number", num);
        if (error) {
          errors.push(`Stations row ${rowNumber}: ${error.message}`);
          continue;
        }
        stationByNumber.delete(num);
        maxStationNumber -= 1;
        summary.stationsDeleted++;
        continue;
      }

      if (name) {
        // Only include is_run in the update when the column actually
        // exists in this sheet - an older file that predates this
        // column (or one downloaded before it existed) must never wipe
        // out Run flags that were set some other way since.
        const update: Record<string, unknown> = { name };
        if (isRunProvided) update.is_run = isRunValue;
        const { error } = await admin.from("stations").update(update).eq("number", num);
        if (error) {
          errors.push(`Stations row ${rowNumber}: ${error.message}`);
          continue;
        }
        stationByNumber.set(num, name);
        summary.stationsUpdated++;
      }
    }
  }

  // ---------------------------------------------------------------- Heats
  const { data: existingWaves, error: wavesErr } = await admin
    .from("waves")
    .select("wave_number, scheduled_start, actual_start");
  if (wavesErr) return NextResponse.json({ error: wavesErr.message }, { status: 500 });

  type HeatState = { scheduled_start: string; actual_start: string | null };
  const waveByNumber = new Map<number, HeatState>(
    (existingWaves ?? []).map((w) => [w.wave_number, { scheduled_start: w.scheduled_start, actual_start: w.actual_start }])
  );
  const eventDateFallback =
    existingWaves && existingWaves.length > 0 ? String(existingWaves[0].scheduled_start).slice(0, 10) : null;

  const heatsSheet = workbook.getWorksheet("Heats");
  if (heatsSheet) {
    const header = (heatsSheet.getRow(1).values as any[]).map((v) => (typeof v === "string" ? v.trim() : v));
    const col = (name: string) => header.indexOf(name);
    const heatCol = col("Heat (do not edit)");
    const timeCol = col("Scheduled Time (HH:MM)");
    const deleteCol = col("Delete?");

    if (heatCol === -1 || timeCol === -1) {
      return NextResponse.json(
        { error: "Heats sheet is missing an expected column - please use the downloaded template as-is" },
        { status: 400 }
      );
    }

    // Need the team count per heat to guard deletes - fetched once, kept
    // in sync locally as teams get added/deleted further down.
    const { data: teamsForCount, error: countErr } = await admin.from("teams").select("id, wave");
    if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
    const teamCountByWave = new Map<number, number>();
    for (const t of teamsForCount ?? []) {
      if (t.wave != null) teamCountByWave.set(t.wave, (teamCountByWave.get(t.wave) ?? 0) + 1);
    }

    let rowNumber = 1;
    for (const row of heatsSheet.getRows(2, heatsSheet.rowCount - 1) ?? []) {
      rowNumber++;
      const values = row.values as any[];
      const heatNum = cellNumber(values[heatCol]);
      const time = parseTimeCell(values[timeCol]);
      const del = isTruthy(values[deleteCol]);
      if (heatNum == null && time == null) continue; // fully blank row

      if (heatNum == null) {
        // ADD a heat.
        if (!time) {
          errors.push(`Heats row ${rowNumber}: a time is required to add a heat`);
          continue;
        }
        if (!eventDateFallback) {
          errors.push(`Heats row ${rowNumber}: can't add a heat with no existing heat to borrow the event date from`);
          continue;
        }
        let candidate = 1;
        while (waveByNumber.has(candidate)) candidate++;
        const scheduled_start = `${eventDateFallback}T${time}:00`;
        const { error } = await admin.from("waves").insert({ wave_number: candidate, scheduled_start });
        if (error) {
          errors.push(`Heats row ${rowNumber}: ${error.message}`);
          continue;
        }
        waveByNumber.set(candidate, { scheduled_start, actual_start: null });
        summary.heatsAdded++;
        continue;
      }

      const existing = waveByNumber.get(heatNum);
      if (!existing) {
        errors.push(`Heats row ${rowNumber}: heat ${heatNum} doesn't exist`);
        continue;
      }

      if (del) {
        if (existing.actual_start) {
          errors.push(`Heats row ${rowNumber}: heat ${heatNum} has already been started - can't delete it`);
          continue;
        }
        if ((teamCountByWave.get(heatNum) ?? 0) > 0) {
          errors.push(`Heats row ${rowNumber}: heat ${heatNum} still has teams in it - move or delete them first`);
          continue;
        }
        const { error } = await admin.from("waves").delete().eq("wave_number", heatNum);
        if (error) {
          errors.push(`Heats row ${rowNumber}: ${error.message}`);
          continue;
        }
        waveByNumber.delete(heatNum);
        summary.heatsDeleted++;
        continue;
      }

      if (time) {
        const datePart = existing.scheduled_start.slice(0, 10);
        const newScheduledStart = `${datePart}T${time}:00`;
        if (newScheduledStart !== existing.scheduled_start) {
          const { error } = await admin
            .from("waves")
            .update({ scheduled_start: newScheduledStart })
            .eq("wave_number", heatNum);
          if (error) {
            errors.push(`Heats row ${rowNumber}: ${error.message}`);
            continue;
          }
          existing.scheduled_start = newScheduledStart;
          summary.heatsUpdated++;
        }
      }
    }
  }

  // ---------------------------------------------------------------- Teams
  const teamsSheet = workbook.getWorksheet("Teams");
  if (teamsSheet) {
    const header = (teamsSheet.getRow(1).values as any[]).map((v) => (typeof v === "string" ? v.trim() : v));
    const col = (name: string) => header.indexOf(name);
    const idCol = col("Team ID (do not edit)");
    const nameCol = col("Team Name");
    const a1Col = col("Athlete 1");
    const a2Col = col("Athlete 2");
    const divCol = col("Division");
    const heatCol = col("Heat");
    const judgeCol = col("Judge");
    const deleteCol = col("Delete?");

    if (idCol === -1 || nameCol === -1 || heatCol === -1) {
      return NextResponse.json(
        { error: "Teams sheet is missing an expected column - please use the downloaded template as-is" },
        { status: 400 }
      );
    }

    const { data: existingTeams, error: teamsErr } = await admin.from("teams").select("id, wave, team_name");
    if (teamsErr) return NextResponse.json({ error: teamsErr.message }, { status: 500 });

    const { data: scanRows, error: scansErr } = await admin.from("scans").select("team_id");
    if (scansErr) return NextResponse.json({ error: scansErr.message }, { status: 500 });
    const teamsWithScans = new Set((scanRows ?? []).map((s) => s.team_id));

    const allIds = new Set((existingTeams ?? []).map((t) => t.id));
    const waveByTeam = new Map((existingTeams ?? []).map((t) => [t.id, t.wave]));
    const idsByHeat = new Map<number, string[]>();
    for (const t of existingTeams ?? []) {
      if (t.wave == null) continue;
      const list = idsByHeat.get(t.wave) ?? [];
      list.push(t.id);
      idsByHeat.set(t.wave, list);
    }
    // A team's id can drift between a download and an upload - a sibling
    // team moving or the automatic gap-closer running shifts other ids
    // without the admin ever touching that row. Its (heat, name) is far
    // more stable, so that's the fallback when the literal id from the
    // sheet no longer matches anything.
    const idByHeatAndName = new Map<string, string>();
    for (const t of existingTeams ?? []) {
      if (t.wave == null) continue;
      idByHeatAndName.set(`${t.wave}::${t.team_name}`, t.id);
    }

    const { data: judgeRows, error: judgesErr } = await admin.from("judges").select("id, name");
    if (judgesErr) return NextResponse.json({ error: judgesErr.message }, { status: 500 });
    const judgeIdByLowerName = new Map((judgeRows ?? []).map((j) => [j.name.trim().toLowerCase(), j.id]));

    // Blank cell = leave the team's current assignment alone entirely.
    // Non-blank = this becomes the team's complete judge list, replacing
    // whatever was there before. A name that doesn't match any existing
    // judge is reported for that row rather than silently ignored.
    async function applyJudgeCell(teamId: string, cellValue: string | null, rowNumber: number) {
      if (cellValue == null) return;
      const names = cellValue.split(",").map((n) => n.trim()).filter(Boolean);
      const judgeIds: string[] = [];
      for (const name of names) {
        const jid = judgeIdByLowerName.get(name.toLowerCase());
        if (!jid) {
          errors.push(`Teams row ${rowNumber}: no judge named "${name}" - assignment left unchanged`);
          return;
        }
        judgeIds.push(jid);
      }
      await admin.from("judge_team_assignments").delete().eq("team_id", teamId);
      if (judgeIds.length > 0) {
        await admin
          .from("judge_team_assignments")
          .insert(judgeIds.map((judge_id) => ({ judge_id, team_id: teamId })));
      }
    }

    let rowNumber = 1;
    for (const row of teamsSheet.getRows(2, teamsSheet.rowCount - 1) ?? []) {
      rowNumber++;
      const values = row.values as any[];
      let id = cellString(values[idCol]);
      const teamName = cellString(values[nameCol]);
      const athlete1 = cellString(values[a1Col]);
      const athlete2 = cellString(values[a2Col]);
      const division = normalizeDivision(cellString(values[divCol]));
      const heatNum = cellNumber(values[heatCol]);
      const judgeCellValue = judgeCol === -1 ? null : cellString(values[judgeCol]);
      const del = isTruthy(values[deleteCol]);
      if (!id && !teamName && heatNum == null) continue; // fully blank row

      if (heatNum == null) {
        errors.push(`Teams row ${rowNumber}: a Heat number is required`);
        continue;
      }
      const heat = waveByNumber.get(heatNum);
      if (!heat) {
        errors.push(`Teams row ${rowNumber}: heat ${heatNum} doesn't exist`);
        continue;
      }

      async function addTeam(): Promise<string | null> {
        if (!teamName) {
          errors.push(`Teams row ${rowNumber}: a team name is required to add a team`);
          return null;
        }
        const newId = nextTeamId(heatIdPrefix(heat!.scheduled_start), idsByHeat.get(heatNum!) ?? [], allIds);
        const { error } = await admin.from("teams").insert({
          id: newId,
          team_name: teamName,
          athlete_1: athlete1,
          athlete_2: athlete2,
          division,
          wave: heatNum,
          start_time: heat!.scheduled_start,
        });
        if (error) {
          errors.push(`Teams row ${rowNumber}: ${error.message}`);
          return null;
        }
        allIds.add(newId);
        idsByHeat.set(heatNum!, [...(idsByHeat.get(heatNum!) ?? []), newId]);
        waveByTeam.set(newId, heatNum!);
        await applyJudgeCell(newId, judgeCellValue, rowNumber);
        summary.teamsAdded++;
        return newId;
      }

      if (!id) {
        // No id at all - always means "add a new team".
        await addTeam();
        continue;
      }

      if (!allIds.has(id)) {
        const fallback = teamName ? idByHeatAndName.get(`${heatNum}::${teamName}`) : undefined;
        if (fallback) {
          id = fallback;
        } else if (del) {
          // Asked to delete a team that no longer exists under this id -
          // nothing to do, already effectively deleted.
          continue;
        } else {
          // The id doesn't exist and nothing matches by name+heat either -
          // most commonly because a Full Reset wiped every previous id,
          // so NOTHING from before still exists to match against. Rather
          // than block the row, treat it exactly like a blank id: add it
          // as a new team from what this row actually says.
          const newId = await addTeam();
          if (newId) {
            errors.push(
              `Teams row ${rowNumber}: team ${id} no longer existed, so "${teamName}" was added as a new team (${newId}) instead of being updated.`
            );
          }
          continue;
        }
      }

      if (del) {
        const { data: viewer } = await admin.from("team_viewers").select("id").eq("team_id", id).maybeSingle();
        if (viewer) {
          await admin.from("team_viewers").delete().eq("id", viewer.id);
          await admin.auth.admin.deleteUser(viewer.id).catch(() => {});
        }
        const { error } = await admin.from("teams").delete().eq("id", id);
        if (error) {
          errors.push(`Teams row ${rowNumber}: ${error.message}`);
          continue;
        }
        allIds.delete(id);
        const oldWave = waveByTeam.get(id);
        if (oldWave != null) {
          idsByHeat.set(oldWave, (idsByHeat.get(oldWave) ?? []).filter((x) => x !== id));
        }
        summary.teamsDeleted++;
        continue;
      }

      const currentWave = waveByTeam.get(id) ?? null;
      const scanBlocksMove = heatNum !== currentWave && teamsWithScans.has(id);
      if (scanBlocksMove) {
        errors.push(
          `Teams row ${rowNumber}: team ${id} already has scans recorded, so it can't move to heat ${heatNum} - its name/athlete/division were still updated, only the heat move was skipped`
        );
      }
      // Only actually attempt the move if it isn't blocked - a blocked
      // move must never prevent the OTHER fields on this row (name,
      // athletes, division) from updating, which have nothing to do
      // with which heat the team is in.
      const movingHeat = heatNum !== currentWave && !scanBlocksMove;

      const update: Record<string, unknown> = {
        team_name: teamName ?? id,
        athlete_1: athlete1,
        athlete_2: athlete2,
        division,
      };

      let finalId = id;
      if (movingHeat) {
        const idsInDestHeat = (idsByHeat.get(heatNum) ?? []).filter((x) => x !== id);
        const idsMinusSelf = new Set(allIds);
        idsMinusSelf.delete(id);
        const newId = nextTeamId(heatIdPrefix(heat.scheduled_start), idsInDestHeat, idsMinusSelf);
        update.id = newId;
        update.wave = heatNum;
        update.start_time = heat.scheduled_start;
        // The name's position label needs to track the move too - "Team
        // 01" landing at position 9 in its new heat becomes "Team 09".
        // A custom name with no number in it is left untouched.
        update.team_name = renameForPosition(update.team_name as string, positionOf(newId));

        const { error } = await admin.from("teams").update(update).eq("id", id);
        if (error) {
          errors.push(`Teams row ${rowNumber}: ${error.message}`);
          continue;
        }
        allIds.delete(id);
        allIds.add(newId);
        if (currentWave != null) {
          idsByHeat.set(currentWave, (idsByHeat.get(currentWave) ?? []).filter((x) => x !== id));
        }
        idsByHeat.set(heatNum, [...idsInDestHeat, newId]);
        waveByTeam.delete(id);
        waveByTeam.set(newId, heatNum);
        finalId = newId;
      } else {
        const { error } = await admin.from("teams").update(update).eq("id", id);
        if (error) {
          errors.push(`Teams row ${rowNumber}: ${error.message}`);
          continue;
        }
      }
      await applyJudgeCell(finalId, judgeCellValue, rowNumber);
      summary.teamsUpdated++;
    }

    // Closes any gap left behind by a move in this batch (everyone after
    // a departed team's old position shifts down, id and name both) -
    // the same automatic fixer that runs on every admin page load.
    await autoFixTeamIds();

    // A name is only actually ambiguous if it's shared by two teams in
    // the SAME heat - "Team 01" existing once per heat is the intended
    // design (it's a per-heat position label), not a problem. Reusing a
    // name across different heats is completely normal and never flagged.
    const { data: allTeamsAfter } = await admin.from("teams").select("team_name, wave");
    const nameCountsByWave = new Map<string, number>();
    for (const t of allTeamsAfter ?? []) {
      const key = `${t.wave}::${t.team_name}`;
      nameCountsByWave.set(key, (nameCountsByWave.get(key) ?? 0) + 1);
    }
    for (const [key, count] of nameCountsByWave) {
      if (count > 1) {
        const [wave, name] = key.split("::");
        errors.push(
          `Warning: "${name}" is used by ${count} different teams within heat ${wave} - consider giving them distinct names so they're not confused with each other.`
        );
      }
    }
  }

  return NextResponse.json({ ok: true, summary, errors });
}
