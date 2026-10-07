import { NextRequest } from "next/server";
import { usernameToEmail } from "@/lib/username";
import { adminContext, authFail, cleanText, fail, json, readBody } from "../_lib/guard";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";

// Judges are shared by every event (the same people judge each race).
// Their team assignments belong to one event's teams.

export async function GET() {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { data, error } = await ctx.admin.from("judges").select("id, name, active").order("name");
  if (error) return fail("Couldn't load the judges.", 500);
  return json({ judges: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;

  const body = await readBody(req);
  const name = cleanText(body?.name, 60);
  const username = cleanText(body?.username, 40);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!name || !username || !password) return fail("A name, username and password are all needed.");
  if (!/^[a-zA-Z0-9._-]+$/.test(username.replace(/\s+/g, ""))) {
    return fail("Usernames can only use letters, numbers, dots, dashes and underscores.");
  }
  if (password.length < 6 || password.length > 72) return fail("The password must be at least 6 characters.");

  const teamIds = Array.isArray(body?.teamIds)
    ? (body!.teamIds as unknown[]).filter((t): t is string => typeof t === "string" && t.length <= 40)
    : [];

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
  });
  if (authError || !authUser?.user) return authFail(authError, "Couldn't create that login - try a different username.");

  const judgeId = authUser.user.id;
  const { error: judgeInsertError } = await admin.from("judges").insert({ id: judgeId, name, active: true });
  if (judgeInsertError) {
    await admin.auth.admin.deleteUser(judgeId).catch(() => {});
    return fail("Couldn't create the judge - try again.", 500);
  }

  // Assignments only for teams of the active event, and never on a locked one.
  if (teamIds.length > 0 && !event.locked) {
    const { data: teams } = await admin.from("teams").select("id").eq("event_id", event.id).in("id", teamIds);
    const rows = (teams ?? []).map((t) => ({ judge_id: judgeId, team_id: t.id }));
    if (rows.length > 0) {
      const { error: assignError } = await admin.from("judge_team_assignments").insert(rows);
      if (assignError) {
        return json({ ok: true, judgeId, username, warning: "Judge created, but assigning teams failed - assign them below." });
      }
    }
  }

  return json({ ok: true, judgeId, username });
}
