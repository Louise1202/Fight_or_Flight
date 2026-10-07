import { NextRequest } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEventById } from "@/lib/activeEvent";
import { EVENT_COLUMNS } from "@/lib/events";
import { dbFail, fail, json, notAuthorized, readBody } from "../../../_lib/guard";

export const dynamic = "force-dynamic";

// Finish & lock: the event's results are frozen by the database from
// here on (sql/019, guard_locked_event). There is no unlock in the app.
// The caller must send { confirm: "LOCK" }.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminSession()) return notAuthorized();
  const body = await readBody(req);
  if (body?.confirm !== "LOCK") return fail('Type LOCK to confirm.');

  const admin = createAdminClient();
  const event = await getEventById(params.id, admin);
  if (!event) return fail("That event doesn't exist.", 404);
  if (event.locked) return json({ ok: true, event, alreadyLocked: true });

  // A heat still running would be frozen mid-race - end it first.
  const { data: running } = await admin
    .from("waves")
    .select("wave_number")
    .eq("event_id", event.id)
    .not("actual_start", "is", null)
    .is("actual_end", null);
  if ((running ?? []).length > 0) {
    const list = running!.map((w) => w.wave_number).join(", ");
    return fail(`Heat ${list} is still running. End it first, then finish and lock the event.`, 409);
  }

  const { data: saved, error } = await admin
    .from("events")
    .update({ status: "finished", locked: true, registration_open: false })
    .eq("id", event.id)
    .select(EVENT_COLUMNS)
    .single();
  if (error) return dbFail(error, "Couldn't lock the event.");
  return json({ ok: true, event: saved });
}
