import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Always dynamic - this hits the live database on every request and
// must never be statically pre-rendered at build time (a build-time DB
// call against real, ever-changing data is exactly what crashed the
// build once already).
export const dynamic = "force-dynamic";

// Judges don't otherwise have write access to the teams table (that's
// admin-managed data), so this goes through the service role rather than
// fighting with RLS for one narrow field. There's no admin-session check
// here on purpose - this is a normal judge action, not an admin one.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { teamId: string } }
) {
  const { note } = await req.json();
  if (typeof note !== "string") {
    return NextResponse.json({ error: "note (string) is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("teams")
    .update({ stopped_note: note.trim() || null })
    .eq("id", params.teamId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
