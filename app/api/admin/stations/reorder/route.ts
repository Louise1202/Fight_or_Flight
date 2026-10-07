import { NextRequest } from "next/server";
import { adminContext, dbFail, eventHasScans, fail, json, lockedFail, readBody } from "../../_lib/guard";

export const dynamic = "force-dynamic";

// Reorders the ACTIVE event's stations. Blocked once this event has a
// scan - a recorded time would silently start meaning another exercise.
export async function PUT(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  const order = body?.order;
  if (!Array.isArray(order) || order.length > 200 || order.some((n) => !Number.isInteger(n) || n < 1)) {
    return fail("That order isn't valid - refresh and try again.");
  }

  try {
    if (await eventHasScans(admin, event.id)) {
      return fail("Can't reorder stations once a scan has been recorded - the course is locked in for this event.", 409);
    }
  } catch {
    return fail("Couldn't check the event's scans.", 500);
  }

  const { data: existing, error: fetchErr } = await admin.from("stations").select("number").eq("event_id", event.id);
  if (fetchErr) return dbFail(fetchErr, "Couldn't load the stations.");

  const numbers = new Set((existing ?? []).map((s) => s.number));
  if (order.length !== numbers.size || new Set(order).size !== order.length || order.some((n) => !numbers.has(n))) {
    return fail("That order doesn't match the current stations - refresh and try again.");
  }

  // Two-phase renumber (negative first) so no two stations collide mid-run.
  for (const n of order as number[]) {
    const { error } = await admin.from("stations").update({ number: -n }).eq("event_id", event.id).eq("number", n);
    if (error) return dbFail(error, "Couldn't save the new order.");
  }
  for (let i = 0; i < order.length; i++) {
    const { error } = await admin
      .from("stations")
      .update({ number: i + 1 })
      .eq("event_id", event.id)
      .eq("number", -(order[i] as number));
    if (error) return dbFail(error, "Couldn't save the new order.");
  }

  return json({ ok: true });
}
