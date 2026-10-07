import { NextRequest } from "next/server";
import { adminContext, dbFail, fail, json, lockedFail, readBody, teamInEvent } from "../../_lib/guard";

// Tick off who has paid. Athletes of one team often pay separately, so
// this works per athlete: { teamId, position: 1 | 2 | "both", paid }.
// The team counts as paid once every athlete has paid (sql/021 keeps
// teams.paid in sync automatically).
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  const teamId = typeof body?.teamId === "string" ? body.teamId : "";
  const position = body?.position;
  const paid = body?.paid;
  if (!teamId) return fail("Choose a team.");
  if (position !== 1 && position !== 2 && position !== "both") return fail("Choose which athlete paid.");
  if (typeof paid !== "boolean") return fail("Paid must be yes or no.");

  const team = await teamInEvent(admin, teamId, event.id);
  if (!team) return fail("That team isn't in the current event.", 404);

  let q = admin
    .from("team_members")
    .update({ paid, paid_at: paid ? new Date().toISOString() : null })
    .eq("team_id", teamId);
  if (position !== "both") q = q.eq("position", position);
  const { data, error } = await q.select("position, paid, paid_at");
  if (error) return dbFail(error, "Couldn't save the payment.");

  // Teams without athlete records (added by hand) use the team's own flag.
  if (!data || data.length === 0) {
    const { error: teamErr } = await admin.from("teams").update({ paid }).eq("id", teamId).eq("event_id", event.id);
    if (teamErr) return dbFail(teamErr, "Couldn't save the payment.");
    return json({ ok: true, teamPaid: paid, members: [] });
  }

  const { data: t } = await admin.from("teams").select("paid").eq("id", teamId).maybeSingle();
  return json({ ok: true, teamPaid: t?.paid === true, members: data });
}
