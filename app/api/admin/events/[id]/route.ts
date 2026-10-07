import { NextRequest } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEventById } from "@/lib/activeEvent";
import { EVENT_COLUMNS, EventRow } from "@/lib/events";
import { cleanText, dbFail, fail, isValidDate, json, lockedFail, notAuthorized, readBody } from "../../_lib/guard";

export const dynamic = "force-dynamic";

// Changes an event's settings. Only these fields can ever be changed
// here. `locked` and `status: 'finished'` are deliberately NOT in this
// list - finishing and locking is its own explicit action
// (POST /api/admin/events/<id>/lock), and unlocking isn't possible from
// the app at all.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminSession()) return notAuthorized();
  const body = await readBody(req);
  if (!body) return fail("Nothing to save.");

  const admin = createAdminClient();
  const event = await getEventById(params.id, admin);
  if (!event) return fail("That event doesn't exist.", 404);
  if (event.locked) return lockedFail();

  const update: Partial<EventRow> = {};

  if ("name" in body) {
    const name = cleanText(body.name, 80);
    if (!name || name.length < 2) return fail("Give the event a name.");
    update.name = name;
  }
  if ("event_date" in body) {
    if (!isValidDate(body.event_date)) return fail("Choose a valid event date.");
    update.event_date = body.event_date;
  }
  if ("venue" in body) update.venue = cleanText(body.venue, 120);
  if ("registration_time" in body) update.registration_time = cleanText(body.registration_time, 40);
  if ("entry_fee" in body) update.entry_fee = cleanText(body.entry_fee, 200);
  if ("bank_details" in body) update.bank_details = cleanText(body.bank_details, 1000);
  if ("heat_minutes" in body) {
    const m = Number(body.heat_minutes);
    if (!Number.isInteger(m) || m < 10 || m > 240) return fail("Heat length must be between 10 and 240 minutes.");
    update.heat_minutes = m;
  }
  if ("registration_open" in body) {
    if (typeof body.registration_open !== "boolean") return fail("Registration must be open or closed.");
    if (body.registration_open && event.team_id_scheme !== "sequential") {
      return fail("Online sign-up isn't available for this event.");
    }
    update.registration_open = body.registration_open;
  }
  // Results emails switches (sql/020).
  for (const key of ["email_results_auto", "email_final_auto"] as const) {
    if (key in body) {
      if (typeof body[key] !== "boolean") return fail("Results emails must be on or off.");
      update[key] = body[key] as boolean;
    }
  }
  if ("status" in body) {
    // 'finished' only through the lock action.
    if (body.status !== "setup" && body.status !== "live") return fail("That status isn't allowed here.");
    update.status = body.status;
  }
  if ("team_id_prefix" in body) {
    const prefix = typeof body.team_id_prefix === "string" ? body.team_id_prefix.trim().toUpperCase() : "";
    if (!/^[A-Z]{2,4}$/.test(prefix)) return fail("Team ID letters must be 2 to 4 capital letters, e.g. SV.");
    if (prefix !== event.team_id_prefix) {
      const { count } = await admin
        .from("teams")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id);
      if ((count ?? 0) > 0) {
        return fail("Team ID letters can only be changed while the event has no teams.", 409);
      }
      const { data: other } = await admin.from("events").select("name").eq("team_id_prefix", prefix).neq("id", event.id).limit(1);
      if ((other ?? []).length > 0) {
        return fail(`The letters ${prefix} are already used by ${other![0].name}. Choose different letters.`, 409);
      }
      update.team_id_prefix = prefix;
    }
  }

  if (Object.keys(update).length === 0) return fail("Nothing to save.");

  const { data: saved, error } = await admin
    .from("events")
    .update(update)
    .eq("id", event.id)
    .eq("locked", false)
    .select(EVENT_COLUMNS)
    .maybeSingle();
  if (error) return dbFail(error, "Couldn't save the event settings.");
  if (!saved) return lockedFail();

  // Heats keep their time of day but move to the new date. Started heats
  // are left exactly as they are.
  if (update.event_date && update.event_date !== event.event_date) {
    const { data: waves } = await admin
      .from("waves")
      .select("wave_number, scheduled_start, actual_start")
      .eq("event_id", event.id);
    for (const w of waves ?? []) {
      if (w.actual_start) continue;
      const d = new Date(w.scheduled_start);
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mm = String(d.getUTCMinutes()).padStart(2, "0");
      await admin
        .from("waves")
        .update({ scheduled_start: `${update.event_date}T${hh}:${mm}:00` })
        .eq("event_id", event.id)
        .eq("wave_number", w.wave_number);
    }
  }

  return json({ ok: true, event: saved });
}
