import { NextRequest } from "next/server";
import { chunk } from "@/lib/fetchAll";
import { teamIdsForEvent } from "@/lib/activeEvent";
import { adminContext, dbFail, fail, json, lockedFail, readBody } from "../_lib/guard";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";

// Resets the ACTIVE event only - never another event, never judges.
// Refused for a locked event (the database refuses it too).
// Body: { scope: 'race-data' | 'full', confirmName: <the event's exact name> }
export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  const scope = body?.scope;
  if (scope !== "race-data" && scope !== "full") return fail("Choose what to reset.");
  if (typeof body?.confirmName !== "string" || body.confirmName.trim() !== event.name.trim()) {
    return fail(`Type the event name (${event.name}) exactly to confirm.`);
  }

  // A full reset would delete teams' signed registrations (consents,
  // signatures, medical answers) - never allowed once teams have signed
  // up themselves. Withdraw individual teams instead.
  if (scope === "full") {
    const { count: signedUp } = await admin
      .from("teams")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .not("registered_at", "is", null);
    if ((signedUp ?? 0) > 0) {
      return fail(
        `${signedUp} team${signedUp === 1 ? " has" : "s have"} signed up with a signed registration form, so a full reset isn't allowed. Use "Reset race data" instead, or withdraw teams one by one.`,
        409
      );
    }
  }

  const teamIds = await teamIdsForEvent(event.id, admin);

  // Race data: this event's scans, penalties and heat start/end times.
  for (const part of chunk(teamIds)) {
    const { error: scansErr } = await admin.from("scans").delete().in("team_id", part);
    if (scansErr) return dbFail(scansErr, "Couldn't clear the scans.");
    const { error: penErr } = await admin.from("penalties").delete().in("team_id", part);
    if (penErr) return dbFail(penErr, "Couldn't clear the penalties.");
  }
  const { error: waveErr } = await admin
    .from("waves")
    .update({ actual_start: null, actual_end: null, end_reason: null })
    .eq("event_id", event.id);
  if (waveErr) return dbFail(waveErr, "Couldn't clear the heat times.");

  let teamsDeleted = 0;
  if (scope === "full") {
    // This event's teams, their judge assignments and their team logins.
    // Judges themselves are shared by all events and are kept.
    const viewerIds: string[] = [];
    for (const part of chunk(teamIds)) {
      const { data: viewers } = await admin.from("team_viewers").select("id").in("team_id", part);
      viewerIds.push(...(viewers ?? []).map((v) => v.id));
      const { error: assignErr } = await admin.from("judge_team_assignments").delete().in("team_id", part);
      if (assignErr) return dbFail(assignErr, "Couldn't clear the judge assignments.");
      const { error: viewersErr } = await admin.from("team_viewers").delete().in("team_id", part);
      if (viewersErr) return dbFail(viewersErr, "Couldn't clear the team logins.");
    }
    for (const id of viewerIds) await admin.auth.admin.deleteUser(id).catch(() => {});

    for (const part of chunk(teamIds)) {
      const { error: teamsErr } = await admin.from("teams").delete().eq("event_id", event.id).in("id", part);
      if (teamsErr) return dbFail(teamsErr, "Couldn't delete the teams.");
      teamsDeleted += part.length;
    }

    // Team numbers are never handed out twice (someone may still have an
    // old confirmation with that ID), so numbering carries on.
    await admin.from("events").update({ status: "setup" }).eq("id", event.id);
  } else if (event.status === "live") {
    await admin.from("events").update({ status: "setup" }).eq("id", event.id);
  }

  return json({ ok: true, scope, teamsDeleted });
}
