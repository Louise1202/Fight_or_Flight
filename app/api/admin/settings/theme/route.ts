import { NextRequest } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbFail, fail, json, notAuthorized, readBody } from "../../_lib/guard";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";

// Light/dark mode shared by every screen (not per event).
export async function PATCH(req: NextRequest) {
  if (!isAdminSession()) return notAuthorized();
  const body = await readBody(req);
  const theme = body?.theme;
  if (theme !== "dark" && theme !== "light") return fail("Choose light or dark.");

  const admin = createAdminClient();
  const { error } = await admin.from("app_settings").update({ theme }).eq("id", 1);
  if (error) return dbFail(error, "Couldn't save - try again.");
  return json({ ok: true, theme });
}
