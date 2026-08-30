import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameToEmail } from "@/lib/username";

export async function POST(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { teamId, username, password } = await req.json();

  if (!teamId || !username || !password) {
    return NextResponse.json(
      { error: "teamId, username and password are all required" },
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

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authUser?.user) {
    return NextResponse.json(
      { error: authError?.message ?? "Could not create login" },
      { status: 400 }
    );
  }

  const viewerId = authUser.user.id;

  const { error: viewerInsertError } = await admin
    .from("team_viewers")
    .insert({ id: viewerId, team_id: teamId });

  if (viewerInsertError) {
    await admin.auth.admin.deleteUser(viewerId);
    return NextResponse.json({ error: viewerInsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, viewerId, username, email, teamId });
}
