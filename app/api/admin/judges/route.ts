import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameToEmail } from "@/lib/username";

export async function POST(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { name, username, password, teamIds } = await req.json();

  if (!name || !username || !password) {
    return NextResponse.json(
      { error: "name, username and password are all required" },
      { status: 400 }
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const email = usernameToEmail(username);

  // Create the actual login (this replaces the manual "Add User" step
  // in the Supabase dashboard).
  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // skips any confirmation step - judges log in immediately
  });

  if (authError || !authUser?.user) {
    // Supabase returns a specific message when the (fake) email is
    // already in use - surface that plainly rather than a generic error.
    return NextResponse.json(
      { error: authError?.message ?? "Could not create login" },
      { status: 400 }
    );
  }

  const judgeId = authUser.user.id;

  const { error: judgeInsertError } = await admin
    .from("judges")
    .insert({ id: judgeId, name });

  if (judgeInsertError) {
    // Roll back the auth user so we don't leave an orphaned login with
    // no corresponding judges row.
    await admin.auth.admin.deleteUser(judgeId);
    return NextResponse.json({ error: judgeInsertError.message }, { status: 500 });
  }

  if (Array.isArray(teamIds) && teamIds.length > 0) {
    const rows = teamIds.map((teamId: string) => ({ judge_id: judgeId, team_id: teamId }));
    const { error: assignError } = await admin.from("judge_team_assignments").insert(rows);
    if (assignError) {
      return NextResponse.json(
        { error: `Judge created, but assigning teams failed: ${assignError.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true, judgeId, username, email });
}
