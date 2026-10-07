import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { friendlyDbError } from "@/lib/events";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";

// Kept for older open screens; new screens call set_stopped_note()
// directly. Runs as the signed-in judge (not the service role), and the
// database only allows the team's own judge to change the note.
export async function PATCH(req: NextRequest, { params }: { params: { teamId: string } }) {
  const body = await req.json().catch(() => null);
  if (typeof body?.note !== "string") {
    return NextResponse.json({ error: "note (string) is required" }, { status: 400 });
  }

  const supabase = createClient();
  const { error } = await supabase.rpc("set_stopped_note", { p_team_id: params.teamId, p_note: body.note });
  if (error) {
    return NextResponse.json({ error: friendlyDbError(error.code, "Couldn't save the note.") }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
