import { NextRequest } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEventById } from "@/lib/activeEvent";
import { dbFail, fail, json, notAuthorized } from "../../../_lib/guard";

export const dynamic = "force-dynamic";

// Makes this the event that the admin, judges and the public leaderboard
// work with. Changes nothing about the event itself.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminSession()) return notAuthorized();
  const admin = createAdminClient();
  const event = await getEventById(params.id, admin);
  if (!event) return fail("That event doesn't exist.", 404);

  const { error } = await admin.from("app_settings").update({ active_event_id: event.id }).eq("id", 1);
  if (error) return dbFail(error, "Couldn't switch the active event.");
  return json({ ok: true, activeEventId: event.id });
}
