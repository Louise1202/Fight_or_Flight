import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameToEmail } from "@/lib/username";

// Always dynamic - this hits the live database on every request and
// must never be statically pre-rendered at build time.
export const dynamic = "force-dynamic";

function emailToUsername(email: string): string {
  return email.split("@")[0];
}

// Looks up EVERY login currently linked to a team - normally that's
// zero or one, but nothing before this ever stopped more than one from
// being created (see POST below), so this has to be able to show more
// than one rather than crash the way a plain single-row lookup would.
export async function GET(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const teamId = req.nextUrl.searchParams.get("teamId");
  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: viewerRows, error: viewerErr } = await admin
    .from("team_viewers")
    .select("id")
    .eq("team_id", teamId);
  if (viewerErr) return NextResponse.json({ error: viewerErr.message }, { status: 500 });
  if (!viewerRows || viewerRows.length === 0) return NextResponse.json({ viewers: [] });

  const viewers = [];
  for (const v of viewerRows) {
    const { data: authUser } = await admin.auth.admin.getUserById(v.id);
    viewers.push({ id: v.id, username: authUser?.user?.email ? emailToUsername(authUser.user.email) : "(unknown)" });
  }
  return NextResponse.json({ viewers });
}

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

  // Nothing used to stop a second login being created for a team that
  // already had one - that's exactly how a team ends up with two, and
  // once that happens, editing either one breaks (there's no longer a
  // single row to edit). Blocked here at the source now.
  const { data: existing, error: existingErr } = await admin
    .from("team_viewers")
    .select("id")
    .eq("team_id", teamId);
  if (existingErr) return NextResponse.json({ error: existingErr.message }, { status: 500 });
  if (existing && existing.length > 0) {
    return NextResponse.json(
      { error: "This team already has a login - use Edit next to it instead of creating a new one." },
      { status: 400 }
    );
  }

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

// Changes an EXISTING team login's username and/or password. Either
// can be omitted to leave that one as it is - a blank password field
// in the admin UI means "keep the current password", not "clear it".
export async function PATCH(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { teamId, username, password } = await req.json();
  if (!teamId) {
    return NextResponse.json({ error: "teamId is required" }, { status: 400 });
  }
  if (!username && !password) {
    return NextResponse.json({ error: "Nothing to change - provide a new username or password" }, { status: 400 });
  }
  if (password && password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: viewerRows, error: viewerErr } = await admin
    .from("team_viewers")
    .select("id")
    .eq("team_id", teamId);
  if (viewerErr) return NextResponse.json({ error: viewerErr.message }, { status: 500 });
  if (!viewerRows || viewerRows.length === 0) {
    return NextResponse.json(
      { error: "This team doesn't have a login yet - use the form below to create one instead" },
      { status: 400 }
    );
  }
  if (viewerRows.length > 1) {
    return NextResponse.json(
      { error: "This team has more than one login on file - delete the one you don't want first, then edit the other." },
      { status: 409 }
    );
  }

  const update: { email?: string; password?: string } = {};
  if (username) update.email = usernameToEmail(username);
  if (password) update.password = password;

  const { error: updateErr } = await admin.auth.admin.updateUserById(viewerRows[0].id, update);
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, teamId, username: username || undefined });
}

// Removes one specific login by its own id (viewerId), OR every login
// linked to a team at once (teamId) - the latter is for a team with so
// many leftover duplicates that picking through them individually isn't
// realistic; it just clears the slate so a single clean login can be
// created fresh afterward. Either way, removes both the link row and
// the actual login itself, so it can no longer be used to sign in.
export async function DELETE(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const viewerId = req.nextUrl.searchParams.get("viewerId");
  const teamId = req.nextUrl.searchParams.get("teamId");
  if (!viewerId && !teamId) {
    return NextResponse.json({ error: "viewerId or teamId is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  if (teamId) {
    const { data: rows, error: fetchErr } = await admin
      .from("team_viewers")
      .select("id")
      .eq("team_id", teamId);
    if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    for (const row of rows ?? []) {
      await admin.from("team_viewers").delete().eq("id", row.id);
      await admin.auth.admin.deleteUser(row.id).catch(() => {});
    }
    return NextResponse.json({ ok: true, deleted: rows?.length ?? 0 });
  }

  const { error: deleteRowErr } = await admin.from("team_viewers").delete().eq("id", viewerId!);
  if (deleteRowErr) return NextResponse.json({ error: deleteRowErr.message }, { status: 500 });

  await admin.auth.admin.deleteUser(viewerId!).catch(() => {});

  return NextResponse.json({ ok: true });
}
