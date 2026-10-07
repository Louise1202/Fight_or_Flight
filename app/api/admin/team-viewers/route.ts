import { NextRequest } from "next/server";
import { usernameToEmail } from "@/lib/username";
import {
  adminContext,
  authFail,
  dbFail,
  emailToUsername,
  fail,
  json,
  listAllAuthUsers,
  readBody,
  teamInEvent,
} from "../_lib/guard";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";
// The bulk "create every login" can take a while for many teams.
export const maxDuration = 60;

// Team logins ("viewers") for teams of the ACTIVE event. A team login
// only lets that team see its own results; it changes nothing, so it
// stays available on a locked event too.

const USERNAME = /^[a-zA-Z0-9._-]{2,40}$/;

// Every login linked to one team (normally 0 or 1). Usernames come from
// one paged list of auth users - not one lookup per login.
export async function GET(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;

  const teamId = req.nextUrl.searchParams.get("teamId");
  if (!teamId || teamId.length > 40) return fail("Choose a team.");
  const team = await teamInEvent(admin, teamId, event.id).catch(() => null);
  if (!team) return fail("That team isn't in the current event.", 404);

  const { data: viewerRows, error: viewerErr } = await admin.from("team_viewers").select("id").eq("team_id", teamId);
  if (viewerErr) return dbFail(viewerErr, "Couldn't look up this login.");
  if (!viewerRows || viewerRows.length === 0) return json({ viewers: [] });

  let users: { id: string; email: string | null }[];
  try {
    users = await listAllAuthUsers(admin);
  } catch {
    return fail("Couldn't look up this login.", 500);
  }
  const byId = new Map(users.map((u) => [u.id, u.email]));
  const viewers = viewerRows.map((v) => ({ id: v.id, username: emailToUsername(byId.get(v.id)) }));
  return json({ viewers });
}

// Create one login:   { teamId, username, password }
// Create them in bulk: { mode: "bulk", password } - one shared password,
// username = team id in lower case, for every team of the active event
// (not withdrawn) that has no login yet.
export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;

  const body = await readBody(req);
  if (!body) return fail("Please fill in the form and try again.");

  if (body.mode === "bulk") {
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 8 || password.length > 72) return fail("The shared password must be at least 8 characters.");

    const { data: teams, error: teamsErr } = await admin
      .from("teams")
      .select("id")
      .eq("event_id", event.id)
      .neq("status", "withdrawn")
      .order("id");
    if (teamsErr) return dbFail(teamsErr, "Couldn't load the teams.");
    const teamIds = (teams ?? []).map((t) => t.id);

    const { data: viewerRows, error: vErr } = await admin.from("team_viewers").select("team_id").in("team_id", teamIds.length ? teamIds : ["-"]);
    if (vErr) return dbFail(vErr, "Couldn't load the existing logins.");
    const hasLogin = new Set((viewerRows ?? []).map((v) => v.team_id));

    let existingEmails: Set<string>;
    try {
      existingEmails = new Set((await listAllAuthUsers(admin)).map((u) => (u.email ?? "").toLowerCase()));
    } catch {
      return fail("Couldn't check the existing logins.", 500);
    }

    let created = 0;
    let skipped = 0;
    const failed: string[] = [];
    const todo: string[] = [];
    for (const teamId of teamIds) {
      // Already has a login, or a login with that username exists (e.g.
      // left over) - never overwrite anyone's password.
      if (hasLogin.has(teamId) || existingEmails.has(usernameToEmail(teamId.toLowerCase()))) skipped++;
      else todo.push(teamId);
    }

    async function createOne(teamId: string): Promise<boolean> {
      const { data: authUser, error: authError } = await admin.auth.admin.createUser({
        email: usernameToEmail(teamId.toLowerCase()),
        password,
        email_confirm: true,
      });
      if (authError || !authUser?.user) return false;
      const { error: insErr } = await admin.from("team_viewers").insert({ id: authUser.user.id, team_id: teamId });
      if (insErr) {
        await admin.auth.admin.deleteUser(authUser.user.id).catch(() => {});
        return false;
      }
      return true;
    }

    // A few at a time, so 50+ teams finish well inside the time limit.
    for (let i = 0; i < todo.length; i += 5) {
      const batch = todo.slice(i, i + 5);
      const results = await Promise.all(batch.map((t) => createOne(t).catch(() => false)));
      results.forEach((ok, j) => (ok ? created++ : failed.push(batch[j])));
    }
    return json({ ok: true, created, skipped, failed });
  }

  const teamId = typeof body.teamId === "string" ? body.teamId : "";
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!teamId || !username || !password) return fail("Choose a team and fill in a username and password.");
  if (!USERNAME.test(username)) return fail("Usernames can only use letters, numbers, dots, dashes and underscores.");
  if (password.length < 6 || password.length > 72) return fail("The password must be at least 6 characters.");

  const team = await teamInEvent(admin, teamId, event.id).catch(() => null);
  if (!team) return fail("That team isn't in the current event.", 404);

  // One team, one login (also enforced by the database, sql/017).
  const { data: existing, error: existingErr } = await admin.from("team_viewers").select("id").eq("team_id", teamId);
  if (existingErr) return dbFail(existingErr, "Couldn't check this team's login.");
  if (existing && existing.length > 0) {
    return fail("This team already has a login - use Edit next to it instead of creating a new one.", 409);
  }

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
  });
  if (authError || !authUser?.user) return authFail(authError, "Couldn't create that login - try a different username.");

  const viewerId = authUser.user.id;
  const { error: viewerInsertError } = await admin.from("team_viewers").insert({ id: viewerId, team_id: teamId });
  if (viewerInsertError) {
    await admin.auth.admin.deleteUser(viewerId).catch(() => {});
    return dbFail(viewerInsertError, "Couldn't create that login - try again.");
  }

  return json({ ok: true, teamId, username });
}

// Change an existing team login's username and/or password. A blank
// field means "keep it as it is".
export async function PATCH(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;

  const body = await readBody(req);
  const teamId = typeof body?.teamId === "string" ? body.teamId : "";
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!teamId) return fail("Choose a team.");
  if (!username && !password) return fail("Nothing to change - type a new username or password.");
  if (username && !USERNAME.test(username)) return fail("Usernames can only use letters, numbers, dots, dashes and underscores.");
  if (password && (password.length < 6 || password.length > 72)) return fail("The password must be at least 6 characters.");

  const team = await teamInEvent(admin, teamId, event.id).catch(() => null);
  if (!team) return fail("That team isn't in the current event.", 404);

  const { data: viewerRows, error: viewerErr } = await admin.from("team_viewers").select("id").eq("team_id", teamId);
  if (viewerErr) return dbFail(viewerErr, "Couldn't look up this login.");
  if (!viewerRows || viewerRows.length === 0) {
    return fail("This team doesn't have a login yet - create one instead.", 400);
  }
  if (viewerRows.length > 1) {
    return fail("This team has more than one login - delete the one you don't want first, then edit the other.", 409);
  }

  const update: { email?: string; password?: string } = {};
  if (username) update.email = usernameToEmail(username);
  if (password) update.password = password;

  const { error: updateErr } = await admin.auth.admin.updateUserById(viewerRows[0].id, update);
  if (updateErr) return authFail(updateErr, "Couldn't save this login - try again.");

  return json({ ok: true, teamId, username: username || undefined });
}

// Remove one login (?viewerId=) or every login of a team (?teamId=).
// Removes both the link and the login itself.
export async function DELETE(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;

  const viewerId = req.nextUrl.searchParams.get("viewerId");
  const teamId = req.nextUrl.searchParams.get("teamId");
  if (!viewerId && !teamId) return fail("Choose a login to delete.");

  if (teamId) {
    const team = await teamInEvent(admin, teamId, event.id).catch(() => null);
    if (!team) return fail("That team isn't in the current event.", 404);
    const { data: rows, error: fetchErr } = await admin.from("team_viewers").select("id").eq("team_id", teamId);
    if (fetchErr) return dbFail(fetchErr, "Couldn't look up these logins.");
    for (const row of rows ?? []) {
      await admin.from("team_viewers").delete().eq("id", row.id);
      await admin.auth.admin.deleteUser(row.id).catch(() => {});
    }
    return json({ ok: true, deleted: rows?.length ?? 0 });
  }

  // Only a login that belongs to a team of the active event.
  const { data: row } = await admin.from("team_viewers").select("id, team_id").eq("id", viewerId!).maybeSingle();
  if (!row) return fail("That login doesn't exist.", 404);
  const team = await teamInEvent(admin, row.team_id, event.id).catch(() => null);
  if (!team) return fail("That login isn't for a team in the current event.", 404);

  const { error: deleteRowErr } = await admin.from("team_viewers").delete().eq("id", row.id);
  if (deleteRowErr) return dbFail(deleteRowErr, "Couldn't delete that login.");
  await admin.auth.admin.deleteUser(row.id).catch(() => {});
  return json({ ok: true });
}
