import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameToEmail } from "@/lib/username";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { name, username, password } = await req.json();
  const admin = createAdminClient();

  if (name) {
    const { error } = await admin.from("judges").update({ name }).eq("id", params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (username) {
    const { error } = await admin.auth.admin.updateUserById(params.id, {
      email: usernameToEmail(username),
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (password) {
    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }
    const { error } = await admin.auth.admin.updateUserById(params.id, { password });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Assignments first - foreign key would otherwise block deleting the
  // judges row.
  const { error: assignErr } = await admin
    .from("judge_team_assignments")
    .delete()
    .eq("judge_id", params.id);
  if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });

  const { error: judgeErr } = await admin.from("judges").delete().eq("id", params.id);
  if (judgeErr) return NextResponse.json({ error: judgeErr.message }, { status: 500 });

  // Removes their login entirely - not just the app-level record.
  await admin.auth.admin.deleteUser(params.id).catch(() => {});

  return NextResponse.json({ ok: true });
}
