import { NextRequest } from "next/server";
import { adminContext, dbFail, fail, json, lockedFail, readBody } from "../_lib/guard";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";

// Add / remove heats of the ACTIVE event. Race-day control of a heat
// (start / end / undo / edit time) is in /api/admin/waves.

function validTime(t: unknown): t is string {
  if (typeof t !== "string" || !/^\d{2}:\d{2}$/.test(t)) return false;
  const [h, m] = t.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

// Add a heat. Numbered within the event (lowest free number); the date
// always comes from the event itself.
export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  const time = body?.time;
  if (!validTime(time)) return fail("Enter a start time first.");

  const { data: existing, error: fetchErr } = await admin
    .from("waves")
    .select("wave_number")
    .eq("event_id", event.id);
  if (fetchErr) return dbFail(fetchErr, "Couldn't load the heats.");

  const used = new Set((existing ?? []).map((w) => w.wave_number));
  let waveNumber = 1;
  while (used.has(waveNumber)) waveNumber += 1;

  // Wall-clock convention: no timezone, read back with getUTC* (lib/teamId.ts).
  const row = {
    event_id: event.id,
    wave_number: waveNumber,
    scheduled_start: `${event.event_date}T${time}:00`,
  };

  const { error } = await admin.from("waves").insert(row);
  if (error) return dbFail(error, "Couldn't add the heat.");

  return json({
    ok: true,
    wave: { wave_number: waveNumber, scheduled_start: row.scheduled_start, actual_start: null, actual_end: null, end_reason: null },
  });
}

// Remove a heat. Only while it's empty and hasn't been started.
export async function DELETE(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  const waveNumber = body?.waveNumber;
  if (!Number.isInteger(waveNumber)) return fail("Choose a heat.");

  const { data: heat, error: heatErr } = await admin
    .from("waves")
    .select("wave_number, actual_start")
    .eq("event_id", event.id)
    .eq("wave_number", waveNumber as number)
    .maybeSingle();
  if (heatErr) return dbFail(heatErr, "Couldn't load that heat.");
  if (!heat) return fail("That heat doesn't exist.", 404);
  if (heat.actual_start) return fail("This heat has already been started - undo its start first.", 409);

  const { count } = await admin
    .from("teams")
    .select("id", { count: "exact", head: true })
    .eq("event_id", event.id)
    .eq("wave", waveNumber as number);
  if (count && count > 0) {
    return fail(`Heat ${waveNumber} still has ${count} team(s) - move them to another heat first.`, 409);
  }

  const { error } = await admin
    .from("waves")
    .delete()
    .eq("event_id", event.id)
    .eq("wave_number", waveNumber as number);
  if (error) return dbFail(error, "Couldn't remove the heat.");

  return json({ ok: true });
}
