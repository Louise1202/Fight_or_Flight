import { NextRequest } from "next/server";
import { adminContext, cleanText, dbFail, eventHasScans, fail, json, lockedFail, readBody } from "../../_lib/guard";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";

// Edit a station of the ACTIVE event: name and detail are always safe;
// "run" on/off changes the course order, so it's blocked once this event
// has a scan.
export async function PATCH(req: NextRequest, { params }: { params: { number: string } }) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const number = Number(params.number);
  if (!Number.isInteger(number) || number < 1) return fail("That station doesn't exist.", 404);

  const body = await readBody(req);
  if (!body) return fail("Nothing to save.");

  const { data: current, error: curErr } = await admin
    .from("stations")
    .select("number, name, is_run, detail")
    .eq("event_id", event.id)
    .eq("number", number)
    .maybeSingle();
  if (curErr) return dbFail(curErr, "Couldn't load that station.");
  if (!current) return fail("That station doesn't exist.", 404);

  const update: { name?: string; is_run?: boolean; detail?: string | null } = {};
  if ("name" in body) {
    const name = cleanText(body.name, 80);
    if (!name) return fail("A station name is required.");
    update.name = name;
  }
  if ("detail" in body) update.detail = cleanText(body.detail, 120);
  if ("isRun" in body) {
    const isRun = body.isRun === true;
    if (isRun !== current.is_run) {
      try {
        if (await eventHasScans(admin, event.id)) {
          return fail("Teams have already been scanned, so a station can't be switched to or from a run now.", 409);
        }
      } catch {
        return fail("Couldn't check the event's scans.", 500);
      }
      update.is_run = isRun;
    }
  }
  if (Object.keys(update).length === 0) return json({ ok: true });

  const { error } = await admin.from("stations").update(update).eq("event_id", event.id).eq("number", number);
  if (error) return dbFail(error, "Couldn't save that station.");
  return json({ ok: true });
}

// Only the LAST station can be deleted, and only while this event has no scans.
export async function DELETE(_req: NextRequest, { params }: { params: { number: string } }) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const number = Number(params.number);
  if (!Number.isInteger(number) || number < 1) return fail("That station doesn't exist.", 404);

  const { data: all, error: fetchErr } = await admin.from("stations").select("number").eq("event_id", event.id);
  if (fetchErr) return dbFail(fetchErr, "Couldn't load the stations.");
  const maxNumber = (all ?? []).reduce((max, s) => Math.max(max, s.number), 0);
  if (number !== maxNumber) {
    return fail("Only the last station can be deleted - remove them from the end, one at a time.", 409);
  }

  try {
    if (await eventHasScans(admin, event.id)) {
      return fail("Teams have already been scanned in this event, so stations can't be removed.", 409);
    }
  } catch {
    return fail("Couldn't check the event's scans.", 500);
  }

  const { error } = await admin.from("stations").delete().eq("event_id", event.id).eq("number", number);
  if (error) return dbFail(error, "Couldn't remove that station.");
  return json({ ok: true });
}
