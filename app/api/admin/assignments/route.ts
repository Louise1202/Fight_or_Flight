import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { judge_id, team_id } = await req.json();
  if (!judge_id || !team_id) {
    return NextResponse.json({ error: "judge_id and team_id required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("judge_team_assignments")
    .insert({ judge_id, team_id });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { judge_id, team_id } = await req.json();

  const admin = createAdminClient();
  const { error } = await admin
    .from("judge_team_assignments")
    .delete()
    .eq("judge_id", judge_id)
    .eq("team_id", team_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
