import { NextRequest } from "next/server";
import { adminContext, cleanText, dbFail, eventHasScans, fail, json, lockedFail, readBody } from "../_lib/guard";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";

// Stations of the ACTIVE event. Always added at the end (number = max + 1).
// Adding is blocked once this event has a scan: the finish line is
// "one past the last station", so a new station would change what an
// already-recorded finish means.
export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  const name = cleanText(body?.name, 80);
  if (!name) return fail("A station name is required.");
  const isRun = body?.isRun === true;
  const detail = cleanText(body?.detail, 120);

  try {
    if (await eventHasScans(admin, event.id)) {
      return fail("Teams have already been scanned in this event, so stations can't be added any more.", 409);
    }
  } catch {
    return fail("Couldn't check the event's scans.", 500);
  }

  const { data: existing, error: fetchErr } = await admin.from("stations").select("number").eq("event_id", event.id);
  if (fetchErr) return dbFail(fetchErr, "Couldn't load the stations.");
  const nextNumber = (existing ?? []).reduce((max, s) => Math.max(max, s.number), 0) + 1;

  const { error } = await admin
    .from("stations")
    .insert({ event_id: event.id, number: nextNumber, name, is_run: isRun, detail });
  if (error) return dbFail(error, "Couldn't add that station.");

  return json({ ok: true, station: { number: nextNumber, name, isRun, detail } });
}
