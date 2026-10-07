import { NextRequest } from "next/server";
import { usernameToEmail } from "@/lib/username";
import { chunk } from "@/lib/fetchAll";
import { adminContext, authFail, cleanText, dbFail, fail, json, readBody } from "../../_lib/guard";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Edit a judge: name, username, password, or active (reactivate / deactivate).
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin } = ctx;
  if (!UUID.test(params.id)) return fail("That judge doesn't exist.", 404);

  const body = await readBody(req);
  if (!body) return fail("Nothing to save.");

  const { data: judge } = await admin.from("judges").select("id").eq("id", params.id).maybeSingle();
  if (!judge) return fail("That judge doesn't exist.", 404);

  const rowUpdate: { name?: string; active?: boolean } = {};
  if (body.name !== undefined && body.name !== "") {
    const name = cleanText(body.name, 60);
    if (!name) return fail("Give the judge a name.");
    rowUpdate.name = name;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return fail("Choose active or inactive.");
    rowUpdate.active = body.active;
  }

  const authUpdate: { email?: string; password?: string } = {};
  if (typeof body.username === "string" && body.username.trim()) {
    const u = body.username.trim();
    if (u.length > 40 || !/^[a-zA-Z0-9._-]+$/.test(u)) {
      return fail("Usernames can only use letters, numbers, dots, dashes and underscores.");
    }
    authUpdate.email = usernameToEmail(u);
  }
  if (typeof body.password === "string" && body.password) {
    if (body.password.length < 6 || body.password.length > 72) return fail("The password must be at least 6 characters.");
    authUpdate.password = body.password;
  }

  if (Object.keys(rowUpdate).length === 0 && Object.keys(authUpdate).length === 0) return fail("Nothing to save.");

  if (Object.keys(authUpdate).length > 0) {
    const { error } = await admin.auth.admin.updateUserById(params.id, authUpdate);
    if (error) return authFail(error, "Couldn't change the login - try again.");
  }
  if (Object.keys(rowUpdate).length > 0) {
    const { error } = await admin.from("judges").update(rowUpdate).eq("id", params.id);
    if (error) return dbFail(error, "Couldn't save the changes.");
  }

  return json({ ok: true });
}

// Delete a judge. A judge who has recorded anything (in ANY event), or
// who is assigned to teams of a locked event, is never deleted - old
// results keep their name. They're made inactive instead, and only their
// assignments in the active (unlocked) event are removed.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (!UUID.test(params.id)) return fail("That judge doesn't exist.", 404);

  const { data: judge } = await admin.from("judges").select("id").eq("id", params.id).maybeSingle();
  if (!judge) return fail("That judge doesn't exist.", 404);

  const [{ count: scanCount }, { count: penaltyCount }, { data: assignments }] = await Promise.all([
    admin.from("scans").select("id", { count: "exact", head: true }).eq("judge_id", params.id),
    admin.from("penalties").select("id", { count: "exact", head: true }).eq("judge_id", params.id),
    admin.from("judge_team_assignments").select("team_id, teams!inner(event_id)").eq("judge_id", params.id),
  ]);

  const assignmentEventIds = new Set(
    (assignments ?? []).map((a: any) => (Array.isArray(a.teams) ? a.teams[0]?.event_id : a.teams?.event_id) as string)
  );
  let touchesLockedEvent = false;
  if (assignmentEventIds.size > 0) {
    const { data: lockedEvents } = await admin
      .from("events")
      .select("id")
      .in("id", [...assignmentEventIds])
      .eq("locked", true);
    touchesLockedEvent = (lockedEvents ?? []).length > 0;
  }

  const mustKeep = (scanCount ?? 0) > 0 || (penaltyCount ?? 0) > 0 || touchesLockedEvent;

  if (mustKeep) {
    // Remove only their assignments for the active event's teams.
    if (!event.locked) {
      const activeTeamIds = (assignments ?? [])
        .filter((a: any) => (Array.isArray(a.teams) ? a.teams[0]?.event_id : a.teams?.event_id) === event.id)
        .map((a: any) => a.team_id as string);
      for (const part of chunk(activeTeamIds)) {
        const { error } = await admin
          .from("judge_team_assignments")
          .delete()
          .eq("judge_id", params.id)
          .in("team_id", part);
        if (error) return dbFail(error, "Couldn't remove this judge's assignments.");
      }
    }
    const { error } = await admin.from("judges").update({ active: false }).eq("id", params.id);
    if (error) return dbFail(error, "Couldn't make this judge inactive.");
    return json({ ok: true, deactivated: true });
  }

  const { error: assignErr } = await admin.from("judge_team_assignments").delete().eq("judge_id", params.id);
  if (assignErr) return dbFail(assignErr, "Couldn't remove this judge's assignments.");

  const { error: judgeErr } = await admin.from("judges").delete().eq("id", params.id);
  if (judgeErr) {
    // Something still points at this judge - keep them, inactive.
    await admin.from("judges").update({ active: false }).eq("id", params.id);
    return json({ ok: true, deactivated: true });
  }

  await admin.auth.admin.deleteUser(params.id).catch(() => {});
  return json({ ok: true, deactivated: false });
}
