import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchEventScans, getActiveEvent } from "@/lib/activeEvent";
import { brandFor, EventRow, friendlyDbError } from "@/lib/events";
import { fetchAll } from "@/lib/fetchAll";
import { heatIdPrefix, nextTeamId, positionOf, renameForPosition } from "@/lib/teamId";
import { autoFixTeamIds } from "@/lib/rebuildTeamIds";
import { judgeNamesForTeams } from "@/components/results/data";

export const dynamic = "force-dynamic";

// The "build/correct the event" report - a separate, editable round-trip
// from the read-only /api/admin/export audit dump. Downloaded, edited by
// hand (add a row, change a Heat number, tick Delete?), and re-uploaded
// here. Always works on the ACTIVE event only.
export const runtime = "nodejs";

type AdminClient = ReturnType<typeof createAdminClient>;

function cellString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "object" && v !== null && "text" in (v as any)) return cellString((v as any).text);
  if (typeof v === "object" && v !== null && "result" in (v as any)) return cellString((v as any).result);
  const s = String(v).trim();
  return s === "" ? null : s;
}

function cellNumber(v: unknown): number | null {
  const s = cellString(v);
  if (s == null) return null;
  const n = Number(s);
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
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function normalizeDivision(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  const l = v.toLowerCase();
  if (v === "Mens" || l === "men" || l === "boys") return "Men";
  if (v === "Womans" || v === "Womens" || l === "women" || l === "ladies" || l === "girls") return "Women";
  if (l === "mixed") return "Mixed";
  if (l === "kids") return "Kids";
  if (v === "TBC" || v === "") return null;
  return v;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "event";
}

// Heat times use the app's existing convention: scheduled_start holds the
// planned wall-clock time in its UTC components (written as
// `${date}T${HH}:${MM}:00`, read back with getUTCHours()).
function heatHHMM(scheduledStart: string): string {
  const d = new Date(scheduledStart);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** heat_position scheme: event prefix + HHMM of the heat, e.g. "FF0730". */
function heatPrefix(event: EventRow, scheduledStart: string): string {
  return heatIdPrefix(scheduledStart, event.team_id_prefix);
}

function headerIndex(sheet: ExcelJS.Worksheet): (name: string) => number {
  const header = (sheet.getRow(1).values as unknown[]).map((v) => (typeof v === "string" ? v.trim() : v));
  return (name: string) => header.indexOf(name);
}

function dbErr(error: { code?: string } | null | undefined, fallback = "the database refused this row"): string {
  return friendlyDbError(error?.code, fallback);
}

// ===================================================================== GET
export async function GET(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const blank = req.nextUrl.searchParams.get("blank") === "1";
  const admin = createAdminClient();

  let event: EventRow;
  let teams: { id: string; team_name: string; athlete_1: string | null; athlete_2: string | null; division: string | null; wave: number | null }[] = [];
  let waves: { wave_number: number; scheduled_start: string }[] = [];
  let stations: { number: number; name: string; is_run: boolean; detail: string | null }[] = [];
  let judgeNamesByTeamId = new Map<string, string[]>();
  try {
    event = await getActiveEvent(admin);
    if (!blank) {
      const [t, w, s] = await Promise.all([
        fetchAll<(typeof teams)[number]>((from, to) =>
          admin
            .from("teams")
            .select("id, team_name, athlete_1, athlete_2, division, wave")
            .eq("event_id", event.id)
            .order("wave", { ascending: true, nullsFirst: false })
            .order("id", { ascending: true })
            .range(from, to)
        ),
        admin.from("waves").select("wave_number, scheduled_start").eq("event_id", event.id).order("wave_number"),
        admin.from("stations").select("number, name, is_run, detail").eq("event_id", event.id).order("number"),
      ]);
      if (w.error || s.error) throw new Error("query failed");
      teams = t;
      waves = w.data ?? [];
      stations = s.data ?? [];
      judgeNamesByTeamId = (await judgeNamesForTeams(admin, teams.map((x) => x.id))).byTeam;
    }
  } catch {
    return NextResponse.json({ error: "The event report couldn't be built right now - please try again." }, { status: 500 });
  }

  const brand = brandFor(event);
  const sequential = event.team_id_scheme === "sequential";

  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${event.name} Race Timing`;
  workbook.created = new Date();

  const instructions = workbook.addWorksheet("Instructions");
  instructions.columns = [{ width: 100 }];
  [
    `${brand.title.toUpperCase()} - HOW TO USE THIS REPORT`,
    "",
    blank
      ? "This is a BLANK template for building the active event from scratch. Fill in"
      : `This is the active event (${event.name}) - every station, heat, and team. Edit it and`,
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
    "  than a real exercise. Leave it blank for a normal exercise station.",
    "- The Detail column is the short line shown under the name, e.g.",
    "  \"240m · 2x 24kg / 2x 16kg\". Leave blank if not needed.",
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
    sequential
      ? "- Team IDs are permanent: a team keeps its ID even when it moves heat."
      : "- To MOVE a team to a different heat: change its Heat number. Its Team ID",
    sequential
      ? "- To MOVE a team to a different heat: change its Heat number."
      : `  is regenerated automatically to match the new heat (${event.team_id_prefix} + heat time + position).`,
    sequential
      ? "- A team can have no heat yet - leave Heat blank."
      : "- Every team needs a Heat number.",
    "- To ADD a new team: add a new row, leave Team ID blank, fill in the rest.",
    sequential ? "  It gets the next Team ID automatically." : "  Put the Heat number it belongs in.",
    "- To DELETE a team: put anything (e.g. \"x\") in its Delete? column. A team",
    "  that already has scans can't be deleted or moved - withdraw it in /admin.",
    "- The Judge column sets which judge is assigned to that team - type a",
    "  judge's name exactly as it appears in /admin. Leave it blank to leave",
    "  the team's current judge assignment untouched.",
    "",
    "Nothing here ever touches race-day timing (actual start/end times,",
    "scans, penalties) - only the course, the roster, and the schedule.",
  ]
    .filter((line) => line !== "")
    .forEach((line) => instructions.addRow([line]));
  instructions.getRow(1).font = { bold: true, size: 14 };

  const bold = (sheet: ExcelJS.Worksheet) => {
    sheet.getRow(1).font = { bold: true };
  };

  const stationsSheet = workbook.addWorksheet("Stations");
  stationsSheet.columns = [
    { header: "Station (do not edit)", key: "number", width: 20 },
    { header: "Name", key: "name", width: 28 },
    { header: "Is Run?", key: "is_run", width: 10 },
    { header: "Detail", key: "detail", width: 36 },
    { header: "Delete?", key: "delete", width: 10 },
  ];
  for (const s of stations) {
    stationsSheet.addRow({ number: s.number, name: s.name, is_run: s.is_run ? "TRUE" : "", detail: s.detail ?? "", delete: "" });
  }
  bold(stationsSheet);

  const teamsSheet = workbook.addWorksheet("Teams");
  teamsSheet.columns = [
    { header: "Team ID (do not edit)", key: "id", width: 20 },
    { header: "Team Name", key: "team_name", width: 22 },
    { header: "Athlete 1", key: "athlete_1", width: 20 },
    { header: "Athlete 2", key: "athlete_2", width: 20 },
    { header: "Division", key: "division", width: 12 },
    { header: "Heat", key: "wave", width: 8 },
    { header: "Judge", key: "judge", width: 20 },
    { header: "Delete?", key: "delete", width: 10 },
  ];
  for (const t of teams) {
    teamsSheet.addRow({
      id: t.id,
      team_name: t.team_name,
      athlete_1: t.athlete_1 ?? "",
      athlete_2: t.athlete_2 ?? "",
      division: t.division ?? "",
      wave: t.wave ?? "",
      judge: (judgeNamesByTeamId.get(t.id) ?? []).join(", "),
      delete: "",
    });
  }
  bold(teamsSheet);

  const heatsSheet = workbook.addWorksheet("Heats");
  heatsSheet.columns = [
    { header: "Heat (do not edit)", key: "wave_number", width: 18 },
    { header: "Scheduled Time (HH:MM)", key: "time", width: 22 },
    { header: "Delete?", key: "delete", width: 10 },
  ];
  for (const w of waves) {
    heatsSheet.addRow({ wave_number: w.wave_number, time: heatHHMM(w.scheduled_start), delete: "" });
  }
  bold(heatsSheet);

  const buffer = await workbook.xlsx.writeBuffer();
  const base = `${slug(event.name)}-${event.event_date}`;
  const filename = blank ? `${base}-event-template.xlsx` : `${base}-event-report.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

// ==================================================================== POST
// Applies an edited copy of the report: stations, then heats, then teams
// (a team row may reference a heat added earlier in the SAME upload).
// Every row is independent - one bad row is reported and skipped, it never
// aborts the rest of the file.
export async function POST(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  let event: EventRow;
  try {
    event = await getActiveEvent(admin);
  } catch {
    return NextResponse.json({ error: "No active event is set." }, { status: 500 });
  }
  if (event.locked) {
    return NextResponse.json(
      { error: `${event.name}: ${friendlyDbError("RT001", "this event is locked.")} Switch the active event first.` },
      { status: 409 }
    );
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

  // Scans of this event: guard station deletes, team deletes and heat moves.
  let stationsWithScans: Set<number>;
  let teamsWithScans: Set<string>;
  try {
    const scans = await fetchEventScans(event.id, admin);
    stationsWithScans = new Set(scans.map((s) => s.station_number));
    teamsWithScans = new Set(scans.map((s) => s.team_id));
  } catch {
    return NextResponse.json({ error: "Couldn't read this event's scans - nothing was changed." }, { status: 500 });
  }

  try {
    await applyStations(admin, event, workbook, stationsWithScans, errors, summary);
    const waveByNumber = await applyHeats(admin, event, workbook, errors, summary);
    await applyTeams(admin, event, workbook, waveByNumber, teamsWithScans, errors, summary);
  } catch (e) {
    if (e instanceof SheetError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json(
      { error: "The upload stopped part-way because the database didn't answer. Download the report again to see what was applied.", summary, errors },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, summary, errors });
}

class SheetError extends Error {}

type Summary = {
  stationsAdded: number;
  stationsUpdated: number;
  stationsDeleted: number;
  heatsAdded: number;
  heatsUpdated: number;
  heatsDeleted: number;
  teamsAdded: number;
  teamsUpdated: number;
  teamsDeleted: number;
};

// --------------------------------------------------------------- Stations
async function applyStations(
  admin: AdminClient,
  event: EventRow,
  workbook: ExcelJS.Workbook,
  stationsWithScans: Set<number>,
  errors: string[],
  summary: Summary
) {
  const sheet = workbook.getWorksheet("Stations");
  if (!sheet) return;

  const { data: existing, error } = await admin.from("stations").select("number, name").eq("event_id", event.id).order("number");
  if (error) throw new Error("stations query failed");
  const known = new Set((existing ?? []).map((s) => s.number as number));
  let maxNumber = (existing ?? []).reduce((m, s) => Math.max(m, s.number as number), 0);

  const col = headerIndex(sheet);
  const numCol = col("Station (do not edit)");
  const nameCol = col("Name");
  const isRunCol = col("Is Run?");
  const detailCol = col("Detail");
  const deleteCol = col("Delete?");
  if (numCol === -1 || nameCol === -1) {
    throw new SheetError("Stations sheet is missing an expected column - please use the downloaded template as-is");
  }

  // Once any team has a scan the course shape is fixed: adding or
  // deleting a station, or switching one to/from a run, would move the
  // finish line under results already recorded. Names and details can
  // still be corrected.
  const courseLocked = stationsWithScans.size > 0;
  const COURSE_LOCKED_MSG =
    "the race has started - stations can't be added, deleted or switched to/from a run any more (names and details can still change)";

  for (let r = 2; r <= sheet.rowCount; r++) {
    const values = sheet.getRow(r).values as unknown[];
    const num = cellNumber(values[numCol]);
    const name = cellString(values[nameCol]);
    // Is Run? and Detail are only touched when the column exists in the
    // sheet - an older file must never wipe values set some other way.
    const isRunProvided = isRunCol !== -1;
    const isRun = isRunProvided ? isTruthy(values[isRunCol]) : false;
    const detailProvided = detailCol !== -1;
    const detail = detailProvided ? cellString(values[detailCol])?.slice(0, 200) ?? null : null;
    const del = deleteCol !== -1 && isTruthy(values[deleteCol]);
    if (num == null && !name) continue;
    const label = `Stations row ${r}`;

    if (num == null) {
      if (!name) {
        errors.push(`${label}: a name is required to add a station`);
        continue;
      }
      if (courseLocked) {
        errors.push(`${label}: ${COURSE_LOCKED_MSG}`);
        continue;
      }
      const newNumber = maxNumber + 1;
      const row: Record<string, unknown> = { event_id: event.id, number: newNumber, name, is_run: isRun };
      if (detailProvided) row.detail = detail;
      const { error: e } = await admin.from("stations").insert(row);
      if (e) {
        errors.push(`${label}: ${dbErr(e)}`);
        continue;
      }
      known.add(newNumber);
      maxNumber = newNumber;
      summary.stationsAdded++;
      continue;
    }

    if (!known.has(num)) {
      errors.push(`${label}: station ${num} doesn't exist - leave the Station number blank to add a new one instead`);
      continue;
    }

    if (del) {
      if (courseLocked) {
        errors.push(`${label}: ${COURSE_LOCKED_MSG}`);
        continue;
      }
      if (num !== maxNumber) {
        errors.push(`${label}: only the last station can be deleted - remove them from the end, one at a time`);
        continue;
      }
      if (stationsWithScans.has(num)) {
        errors.push(`${label}: teams have already scanned at this station - it can't be removed`);
        continue;
      }
      const { error: e } = await admin.from("stations").delete().eq("event_id", event.id).eq("number", num);
      if (e) {
        errors.push(`${label}: ${dbErr(e)}`);
        continue;
      }
      known.delete(num);
      maxNumber = Math.max(0, ...known);
      summary.stationsDeleted++;
      continue;
    }

    if (name) {
      const update: Record<string, unknown> = { name };
      if (isRunProvided && !courseLocked) update.is_run = isRun;
      if (detailProvided) update.detail = detail;
      const { error: e } = await admin.from("stations").update(update).eq("event_id", event.id).eq("number", num);
      if (e) {
        errors.push(`${label}: ${dbErr(e)}`);
        continue;
      }
      summary.stationsUpdated++;
    }
  }
}

// ------------------------------------------------------------------ Heats
type HeatState = { scheduled_start: string; actual_start: string | null };

async function applyHeats(
  admin: AdminClient,
  event: EventRow,
  workbook: ExcelJS.Workbook,
  errors: string[],
  summary: Summary
): Promise<Map<number, HeatState>> {
  const { data: existing, error } = await admin
    .from("waves")
    .select("wave_number, scheduled_start, actual_start")
    .eq("event_id", event.id);
  if (error) throw new Error("waves query failed");

  const waveByNumber = new Map<number, HeatState>(
    (existing ?? []).map((w) => [w.wave_number as number, { scheduled_start: w.scheduled_start, actual_start: w.actual_start }])
  );

  const sheet = workbook.getWorksheet("Heats");
  if (!sheet) return waveByNumber;

  const col = headerIndex(sheet);
  const heatCol = col("Heat (do not edit)");
  const timeCol = col("Scheduled Time (HH:MM)");
  const deleteCol = col("Delete?");
  if (heatCol === -1 || timeCol === -1) {
    throw new SheetError("Heats sheet is missing an expected column - please use the downloaded template as-is");
  }

  const teamWaves = await fetchAll<{ wave: number | null }>((from, to) =>
    admin.from("teams").select("id, wave").eq("event_id", event.id).order("id").range(from, to)
  );
  const teamCountByWave = new Map<number, number>();
  for (const t of teamWaves) if (t.wave != null) teamCountByWave.set(t.wave, (teamCountByWave.get(t.wave) ?? 0) + 1);

  for (let r = 2; r <= sheet.rowCount; r++) {
    const values = sheet.getRow(r).values as unknown[];
    const heatNum = cellNumber(values[heatCol]);
    const rawTime = values[timeCol];
    const time = parseTimeCell(rawTime);
    const del = deleteCol !== -1 && isTruthy(values[deleteCol]);
    if (heatNum == null && cellString(rawTime) == null && !(rawTime instanceof Date)) continue;
    const label = `Heats row ${r}`;

    if (heatNum == null) {
      if (!time) {
        errors.push(`${label}: a time (HH:MM) is required to add a heat`);
        continue;
      }
      let candidate = 1;
      while (waveByNumber.has(candidate)) candidate++;
      const scheduled_start = `${event.event_date}T${time}:00`;
      const { error: e } = await admin.from("waves").insert({ event_id: event.id, wave_number: candidate, scheduled_start });
      if (e) {
        errors.push(`${label}: ${dbErr(e)}`);
        continue;
      }
      waveByNumber.set(candidate, { scheduled_start, actual_start: null });
      summary.heatsAdded++;
      continue;
    }

    const heat = waveByNumber.get(heatNum);
    if (!heat) {
      errors.push(`${label}: heat ${heatNum} doesn't exist`);
      continue;
    }

    if (del) {
      if (heat.actual_start) {
        errors.push(`${label}: heat ${heatNum} has already been started - can't delete it`);
        continue;
      }
      if ((teamCountByWave.get(heatNum) ?? 0) > 0) {
        errors.push(`${label}: heat ${heatNum} still has teams in it - move or delete them first`);
        continue;
      }
      const { error: e } = await admin.from("waves").delete().eq("event_id", event.id).eq("wave_number", heatNum);
      if (e) {
        errors.push(`${label}: ${dbErr(e)}`);
        continue;
      }
      waveByNumber.delete(heatNum);
      summary.heatsDeleted++;
      continue;
    }

    if (cellString(rawTime) != null && !time) {
      errors.push(`${label}: "${cellString(rawTime)}" isn't a time - use HH:MM`);
      continue;
    }
    if (time && heatHHMM(heat.scheduled_start) !== time) {
      const datePart = String(heat.scheduled_start).slice(0, 10);
      const newStart = `${datePart}T${time}:00`;
      const { error: e } = await admin
        .from("waves")
        .update({ scheduled_start: newStart })
        .eq("event_id", event.id)
        .eq("wave_number", heatNum);
      if (e) {
        errors.push(`${label}: ${dbErr(e)}`);
        continue;
      }
      heat.scheduled_start = newStart;
      summary.heatsUpdated++;
    }
  }

  return waveByNumber;
}

// ------------------------------------------------------------------ Teams
async function applyTeams(
  admin: AdminClient,
  event: EventRow,
  workbook: ExcelJS.Workbook,
  waveByNumber: Map<number, HeatState>,
  teamsWithScans: Set<string>,
  errors: string[],
  summary: Summary
) {
  const sheet = workbook.getWorksheet("Teams");
  if (!sheet) return;

  const sequential = event.team_id_scheme === "sequential";
  const col = headerIndex(sheet);
  const idCol = col("Team ID (do not edit)");
  const nameCol = col("Team Name");
  const a1Col = col("Athlete 1");
  const a2Col = col("Athlete 2");
  const divCol = col("Division");
  const heatCol = col("Heat");
  const judgeCol = col("Judge");
  const deleteCol = col("Delete?");
  if (idCol === -1 || nameCol === -1 || heatCol === -1) {
    throw new SheetError("Teams sheet is missing an expected column - please use the downloaded template as-is");
  }

  const existingTeams = await fetchAll<{ id: string; wave: number | null; team_name: string }>((from, to) =>
    admin.from("teams").select("id, wave, team_name").eq("event_id", event.id).order("id").range(from, to)
  );

  const allIds = new Set(existingTeams.map((t) => t.id));
  const waveByTeam = new Map(existingTeams.map((t) => [t.id, t.wave]));
  const idsByHeat = new Map<number, string[]>();
  for (const t of existingTeams) {
    if (t.wave == null) continue;
    idsByHeat.set(t.wave, [...(idsByHeat.get(t.wave) ?? []), t.id]);
  }
  // Fallback match when the id in the sheet no longer exists: by heat +
  // name (heat_position, where ids drift) or by name alone (sequential,
  // where names are unique within the event).
  const idByKey = new Map<string, string>();
  for (const t of existingTeams) {
    const key = sequential ? (t.team_name ?? "").trim().toLowerCase() : `${t.wave}::${t.team_name}`;
    idByKey.set(key, t.id);
  }
  const keyFor = (heat: number | null, name: string) => (sequential ? name.trim().toLowerCase() : `${heat}::${name}`);

  const { data: judgeRows, error: judgesErr } = await admin.from("judges").select("id, name");
  if (judgesErr) throw new Error("judges query failed");
  const judgeIdByLowerName = new Map((judgeRows ?? []).map((j) => [String(j.name ?? "").trim().toLowerCase(), j.id as string]));

  const teamDbErr = (e: { code?: string } | null) =>
    e?.code === "23505" ? "another team in this event already has that name (or ID)" : dbErr(e);

  // Blank cell = leave the team's current assignment alone. Non-blank =
  // this becomes the team's complete judge list.
  async function applyJudgeCell(teamId: string, cellValue: string | null, label: string) {
    if (cellValue == null) return;
    const names = cellValue.split(",").map((n) => n.trim()).filter(Boolean);
    const judgeIds: string[] = [];
    for (const name of names) {
      const jid = judgeIdByLowerName.get(name.toLowerCase());
      if (!jid) {
        errors.push(`${label}: no judge named "${name}" - assignment left unchanged`);
        return;
      }
      judgeIds.push(jid);
    }
    const { error: delErr } = await admin.from("judge_team_assignments").delete().eq("team_id", teamId);
    if (delErr) {
      errors.push(`${label}: judge assignment not changed - ${dbErr(delErr)}`);
      return;
    }
    if (judgeIds.length > 0) {
      const { error: insErr } = await admin
        .from("judge_team_assignments")
        .insert([...new Set(judgeIds)].map((judge_id) => ({ judge_id, team_id: teamId })));
      if (insErr) errors.push(`${label}: judge assignment not saved - ${dbErr(insErr)}`);
    }
  }

  for (let r = 2; r <= sheet.rowCount; r++) {
    const values = sheet.getRow(r).values as unknown[];
    let id = cellString(values[idCol]);
    const teamName = cellString(values[nameCol]);
    const athlete1 = a1Col === -1 ? null : cellString(values[a1Col]);
    const athlete2 = a2Col === -1 ? null : cellString(values[a2Col]);
    const division = divCol === -1 ? null : normalizeDivision(cellString(values[divCol]));
    const heatNum = cellNumber(values[heatCol]);
    const judgeCellValue = judgeCol === -1 ? null : cellString(values[judgeCol]);
    const del = deleteCol !== -1 && isTruthy(values[deleteCol]);
    if (!id && !teamName && heatNum == null) continue;
    const label = `Teams row ${r}`;

    // Heat: required for heat_position; optional (blank = no heat yet) for sequential.
    if (heatNum == null && !sequential && !del) {
      errors.push(`${label}: a Heat number is required`);
      continue;
    }
    const heat = heatNum != null ? waveByNumber.get(heatNum) : undefined;
    if (heatNum != null && !heat && !del) {
      errors.push(`${label}: heat ${heatNum} doesn't exist`);
      continue;
    }
    const startTime = heat ? heat.scheduled_start : `${event.event_date}T00:00:00`;

    async function addTeam(): Promise<string | null> {
      if (!teamName) {
        errors.push(`${label}: a team name is required to add a team`);
        return null;
      }
      let newId: string;
      if (sequential) {
        const { data, error } = await admin.rpc("allocate_team_id", { p_event_id: event.id });
        if (error || typeof data !== "string") {
          errors.push(`${label}: couldn't get a new Team ID - ${dbErr(error)}`);
          return null;
        }
        newId = data;
      } else {
        newId = nextTeamId(heatPrefix(event, heat!.scheduled_start), idsByHeat.get(heatNum!) ?? [], allIds);
      }
      const { error } = await admin.from("teams").insert({
        id: newId,
        event_id: event.id,
        team_name: teamName,
        athlete_1: athlete1,
        athlete_2: athlete2,
        division,
        wave: heatNum,
        start_time: startTime,
      });
      if (error) {
        errors.push(`${label}: "${teamName}" not added - ${teamDbErr(error)}`);
        return null;
      }
      allIds.add(newId);
      if (heatNum != null) idsByHeat.set(heatNum, [...(idsByHeat.get(heatNum) ?? []), newId]);
      waveByTeam.set(newId, heatNum);
      idByKey.set(keyFor(heatNum, teamName), newId);
      await applyJudgeCell(newId, judgeCellValue, label);
      summary.teamsAdded++;
      return newId;
    }

    if (!id) {
      if (del) continue; // nothing to delete
      await addTeam();
      continue;
    }

    if (!allIds.has(id)) {
      const fallback = teamName ? idByKey.get(keyFor(heatNum, teamName)) : undefined;
      if (fallback) {
        id = fallback;
      } else if (del) {
        continue; // already gone
      } else {
        const newId = await addTeam();
        if (newId) {
          errors.push(`${label}: team ${id} isn't in this event, so "${teamName}" was added as a new team (${newId}).`);
        }
        continue;
      }
    }

    if (del) {
      if (teamsWithScans.has(id)) {
        errors.push(`${label}: team ${id} - ${friendlyDbError("RT002", "it has results recorded.")}`);
        continue;
      }
      const { data: viewer } = await admin.from("team_viewers").select("id").eq("team_id", id).maybeSingle();
      const { error } = await admin.from("teams").delete().eq("id", id).eq("event_id", event.id);
      if (error) {
        errors.push(`${label}: team ${id} not deleted - ${dbErr(error)}`);
        continue;
      }
      // team_viewers row goes with the team (ON DELETE CASCADE); remove its login too.
      if (viewer?.id) await admin.auth.admin.deleteUser(viewer.id).catch(() => undefined);
      allIds.delete(id);
      const oldWave = waveByTeam.get(id);
      if (oldWave != null) idsByHeat.set(oldWave, (idsByHeat.get(oldWave) ?? []).filter((x) => x !== id));
      waveByTeam.delete(id);
      summary.teamsDeleted++;
      continue;
    }

    const currentWave = waveByTeam.get(id) ?? null;
    const wantsMove = heatNum !== currentWave;
    const scanBlocksMove = wantsMove && teamsWithScans.has(id);
    if (scanBlocksMove) {
      errors.push(
        `${label}: team ${id} already has scans recorded, so it can't move heat - its other details were still updated`
      );
    }
    // Joining a heat that has started would put time on the team's clock.
    const startedBlocksMove = wantsMove && !scanBlocksMove && !!heat?.actual_start;
    if (startedBlocksMove) {
      errors.push(
        `${label}: heat ${heatNum} has already started, so team ${id} can't move into it - its other details were still updated`
      );
    }
    const movingHeat = wantsMove && !scanBlocksMove && !startedBlocksMove;

    const update: Record<string, unknown> = {
      team_name: teamName ?? id,
      athlete_1: athlete1,
      athlete_2: athlete2,
      division,
    };

    let finalId = id;
    if (movingHeat && sequential) {
      // Permanent ids: only the heat changes.
      update.wave = heatNum;
      update.start_time = startTime;
    } else if (movingHeat) {
      const idsInDestHeat = (idsByHeat.get(heatNum!) ?? []).filter((x) => x !== id);
      const idsMinusSelf = new Set(allIds);
      idsMinusSelf.delete(id);
      const newId = nextTeamId(heatPrefix(event, heat!.scheduled_start), idsInDestHeat, idsMinusSelf);
      update.id = newId;
      update.wave = heatNum;
      update.start_time = startTime;
      // "Team 01" landing at position 9 in its new heat becomes "Team 09".
      update.team_name = renameForPosition(update.team_name as string, positionOf(newId));
      finalId = newId;
    }

    const { error } = await admin.from("teams").update(update).eq("id", id).eq("event_id", event.id);
    if (error) {
      errors.push(`${label}: team ${id} not updated - ${teamDbErr(error)}`);
      continue;
    }
    if (movingHeat) {
      if (finalId !== id) {
        allIds.delete(id);
        allIds.add(finalId);
        waveByTeam.delete(id);
      }
      if (currentWave != null) idsByHeat.set(currentWave, (idsByHeat.get(currentWave) ?? []).filter((x) => x !== id));
      if (heatNum != null) idsByHeat.set(heatNum, [...(idsByHeat.get(heatNum) ?? []), finalId]);
      waveByTeam.set(finalId, heatNum);
    }
    await applyJudgeCell(finalId, judgeCellValue, label);
    summary.teamsUpdated++;
  }

  // heat_position only: a name shared by two teams in the SAME heat is
  // worth a warning ("Team 01" once per heat is the intended design).
  // Sequential events can't have duplicate names - the database refuses.
  if (!sequential) {
    // Close any gap a move left behind (positions shift down, id and name).
    await autoFixTeamIds(event.id);

    const after = await fetchAll<{ team_name: string; wave: number | null }>((from, to) =>
      admin.from("teams").select("id, team_name, wave").eq("event_id", event.id).order("id").range(from, to)
    );
    const counts = new Map<string, number>();
    for (const t of after) {
      const key = `${t.wave}::${t.team_name}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      if (count > 1) {
        const [wave, name] = key.split("::");
        errors.push(`Warning: "${name}" is used by ${count} different teams within heat ${wave} - consider distinct names.`);
      }
    }
  }
}
