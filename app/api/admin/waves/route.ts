import { NextRequest } from "next/server";
import { autoFixTeamIds } from "@/lib/rebuildTeamIds";
import { chunk } from "@/lib/fetchAll";
import { processResultEmailsSafely } from "@/lib/resultsEmail";
import { inBackground } from "@/lib/background";
import { adminContext, AdminClient, dbFail, fail, json, lockedFail, readBody } from "../_lib/guard";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";

// Race-day control of the ACTIVE event's heats. A heat is always
// identified by (event_id, wave_number).

const WAVE_COLUMNS = "wave_number, scheduled_start, actual_start, actual_end, end_reason";

function waveNumberOf(body: Record<string, unknown> | null): number | null {
  const n = body?.waveNumber;
  return Number.isInteger(n) && (n as number) > 0 ? (n as number) : null;
}

async function loadWave(admin: AdminClient, eventId: string, waveNumber: number) {
  const { data, error } = await admin
    .from("waves")
    .select(WAVE_COLUMNS)
    .eq("event_id", eventId)
    .eq("wave_number", waveNumber)
    .maybeSingle();
  if (error) throw new Error("wave");
  return data;
}

async function heatHasScans(admin: AdminClient, eventId: string, waveNumber: number): Promise<boolean> {
  const { data: teams } = await admin
    .from("teams")
    .select("id")
    .eq("event_id", eventId)
    .eq("wave", waveNumber);
  const ids = (teams ?? []).map((t) => t.id);
  for (const part of chunk(ids)) {
    const { count } = await admin.from("scans").select("id", { count: "exact", head: true }).in("team_id", part);
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

// Start a heat. Only if it hasn't started - pressing twice must never
// restart the clock (the update itself checks actual_start is null).
export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const waveNumber = waveNumberOf(await readBody(req));
  if (!waveNumber) return fail("Choose a heat.");

  const { data, error } = await admin
    .from("waves")
    .update({ actual_start: new Date().toISOString(), actual_end: null, end_reason: null })
    .eq("event_id", event.id)
    .eq("wave_number", waveNumber)
    .is("actual_start", null)
    .select(WAVE_COLUMNS);
  if (error) return dbFail(error, "Couldn't start the heat.");
  if (!data || data.length === 0) {
    const existing = await loadWave(admin, event.id, waveNumber).catch(() => null);
    if (!existing) return fail("That heat doesn't exist.", 404);
    return fail("Heat already started", 409, { wave: existing });
  }

  // The first heat to start makes the event "live".
  if (event.status === "setup") {
    await admin.from("events").update({ status: "live" }).eq("id", event.id).eq("status", "setup");
  }

  return json({ ok: true, wave: data[0] });
}

// End a heat by hand (a team DNFs and will never cross the line).
// Only a heat that is running.
export async function PATCH(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const waveNumber = waveNumberOf(await readBody(req));
  if (!waveNumber) return fail("Choose a heat.");

  const { data, error } = await admin
    .from("waves")
    .update({ actual_end: new Date().toISOString(), end_reason: "manual" })
    .eq("event_id", event.id)
    .eq("wave_number", waveNumber)
    .not("actual_start", "is", null)
    .is("actual_end", null)
    .select(WAVE_COLUMNS);
  if (error) return dbFail(error, "Couldn't end the heat.");
  if (!data || data.length === 0) {
    const existing = await loadWave(admin, event.id, waveNumber).catch(() => null);
    if (!existing) return fail("That heat doesn't exist.", 404);
    if (!existing.actual_start) return fail("This heat hasn't started yet.", 409, { wave: existing });
    return fail("This heat has already ended.", 409, { wave: existing });
  }
  // Results emails for this heat's teams. Short time budget, never fails
  // the action; anything left over is sent by the every-minute cron.
  // Results emails go out after the reply - the admin never waits for them
  // (the every-minute cron picks up anything left over).
  inBackground(() => processResultEmailsSafely(event.id, 6000));
  return json({ ok: true, wave: data[0] });
}

// Undo a mis-click. field 'start': only when no team in the heat has a
// scan. field 'end': reopens the heat (clears actual_end and end_reason).
export async function DELETE(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  const waveNumber = waveNumberOf(body);
  const field = body?.field;
  if (!waveNumber || (field !== "start" && field !== "end")) return fail("Choose a heat and what to undo.");

  let existing;
  try {
    existing = await loadWave(admin, event.id, waveNumber);
  } catch {
    return fail("Couldn't load that heat.", 500);
  }
  if (!existing) return fail("That heat doesn't exist.", 404);

  if (field === "start") {
    if (!existing.actual_start) return json({ ok: true, wave: existing });
    if (existing.actual_end) return fail("Reopen the heat before undoing its start.", 409);
    if (await heatHasScans(admin, event.id, waveNumber)) {
      return fail("Teams in this heat already have scans recorded, so the start can't be undone.", 409);
    }
    const { data, error } = await admin
      .from("waves")
      .update({ actual_start: null, actual_end: null, end_reason: null })
      .eq("event_id", event.id)
      .eq("wave_number", waveNumber)
      .select(WAVE_COLUMNS);
    if (error) return dbFail(error, "Couldn't undo the start.");
    return json({ ok: true, wave: data?.[0] ?? null });
  }

  const { data, error } = await admin
    .from("waves")
    .update({ actual_end: null, end_reason: null })
    .eq("event_id", event.id)
    .eq("wave_number", waveNumber)
    .select(WAVE_COLUMNS);
  if (error) return dbFail(error, "Couldn't reopen the heat.");
  return json({ ok: true, wave: data?.[0] ?? null });
}

// Edit the SCHEDULED time of day of a heat that hasn't started. The date
// always comes from the event.
export async function PUT(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  const waveNumber = waveNumberOf(body);
  const time = body?.time;
  if (!waveNumber || typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return fail("Choose a heat and a time.");
  }

  let existing;
  try {
    existing = await loadWave(admin, event.id, waveNumber);
  } catch {
    return fail("Couldn't load that heat.", 500);
  }
  if (!existing) return fail("That heat doesn't exist.", 404);
  if (existing.actual_start) return fail("This heat has already started - its time can't change now.", 409);

  // Wall-clock convention: no timezone, read back with getUTC* (lib/teamId.ts).
  const newScheduledStart = `${event.event_date}T${time}:00`;
  const { error } = await admin
    .from("waves")
    .update({ scheduled_start: newScheduledStart })
    .eq("event_id", event.id)
    .eq("wave_number", waveNumber);
  if (error) return dbFail(error, "Couldn't save the new time.");

  // Keep the teams' legacy start_time column in step with their heat.
  await admin
    .from("teams")
    .update({ start_time: newScheduledStart })
    .eq("event_id", event.id)
    .eq("wave", waveNumber);

  // Only Fight-or-Flight-style ids contain the heat time. Sequential ids
  // never change (autoFixTeamIds does nothing for them).
  let idsUpdated = 0;
  let orphaned: { id: string; team_name: string }[] = [];
  if (event.team_id_scheme === "heat_position") {
    const r = await autoFixTeamIds(event.id);
    idsUpdated = r.updated;
    orphaned = r.orphaned;
  }

  return json({ ok: true, scheduled_start: newScheduledStart, idsUpdated, orphaned });
}
