import { NextRequest } from "next/server";
import { adminContext, dbFail, fail, json, lockedFail, readBody } from "../_lib/guard";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function teamIdsFrom(body: Record<string, unknown>): string[] | null {
  const raw = Array.isArray(body.team_ids) ? body.team_ids : body.team_id != null ? [body.team_id] : [];
  if (raw.length === 0 || raw.length > 500) return null;
  if (raw.some((t) => typeof t !== "string" || t.length === 0 || t.length > 40)) return null;
  return [...new Set(raw as string[])];
}

// Assign one or more teams (of the ACTIVE event) to an active judge.
// Body: { judge_id, team_id } or { judge_id, team_ids: [...] }
export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  const judgeId = body?.judge_id;
  const teamIds = body ? teamIdsFrom(body) : null;
  if (typeof judgeId !== "string" || !UUID.test(judgeId) || !teamIds) {
    return fail("Choose a judge and at least one team.");
  }

  const { data: judge } = await admin.from("judges").select("id, active").eq("id", judgeId).maybeSingle();
  if (!judge) return fail("That judge doesn't exist.", 404);
  if (judge.active === false) return fail("This judge is inactive. Reactivate them first.", 409);

  const { data: teams, error: teamsErr } = await admin
    .from("teams")
    .select("id")
    .eq("event_id", event.id)
    .in("id", teamIds);
  if (teamsErr) return dbFail(teamsErr, "Couldn't check those teams.");
  const valid = new Set((teams ?? []).map((t) => t.id));
  const rows = teamIds.filter((t) => valid.has(t)).map((team_id) => ({ judge_id: judgeId, team_id }));
  if (rows.length === 0) return fail("Those teams aren't in the current event.");

  const { error } = await admin
    .from("judge_team_assignments")
    .upsert(rows, { onConflict: "judge_id,team_id", ignoreDuplicates: true });
  if (error) return dbFail(error, "Couldn't save the assignment.");
  return json({ ok: true, assigned: rows.map((r) => r.team_id) });
}

export async function DELETE(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  const judgeId = body?.judge_id;
  const teamId = body?.team_id;
  if (typeof judgeId !== "string" || !UUID.test(judgeId) || typeof teamId !== "string" || !teamId) {
    return fail("Choose a judge and a team.");
  }

  const { data: team } = await admin
    .from("teams")
    .select("id")
    .eq("id", teamId)
    .eq("event_id", event.id)
    .maybeSingle();
  if (!team) return fail("That team isn't in the current event.", 404);

  const { error } = await admin
    .from("judge_team_assignments")
    .delete()
    .eq("judge_id", judgeId)
    .eq("team_id", teamId);
  if (error) return dbFail(error, "Couldn't remove the assignment.");
  return json({ ok: true });
}
