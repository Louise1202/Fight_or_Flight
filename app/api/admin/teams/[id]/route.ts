import { NextRequest } from "next/server";
import { heatIdPrefix, nextTeamId, positionOf, renameForPosition } from "@/lib/teamId";
import { autoFixTeamIds } from "@/lib/rebuildTeamIds";
import { sendAdminAlert } from "@/lib/adminAlerts";
import { inBackground } from "@/lib/background";
import { adminContext, cleanText, dbFail, fail, json, lockedFail, readBody } from "../../_lib/guard";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";

const DIVISIONS = ["Men", "Women", "Mixed"];
const STATUSES = ["registered", "confirmed", "withdrawn"];

// Edit a team of the ACTIVE event. Accepted fields: team_name,
// athlete_1, athlete_2, division, wave (number or null = no heat yet),
// paid (boolean), status ('registered' | 'confirmed' | 'withdrawn').
//
// Changing heat:
// - sequential events: the id NEVER changes - only wave and start_time.
// - heat_position events: the id follows the heat (letters + HHMM +
//   position), then the old heat's gap is closed by autoFixTeamIds.
// Either way a team that already has scans can't change heat.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  if (!body) return fail("Nothing to save.");

  const { data: current, error: currentErr } = await admin
    .from("teams")
    .select("id, wave, team_name, status")
    .eq("id", params.id)
    .eq("event_id", event.id)
    .maybeSingle();
  if (currentErr) return dbFail(currentErr, "Couldn't load this team.");
  if (!current) return fail("That team isn't in the current event.", 404);

  const update: Record<string, unknown> = {};

  if ("team_name" in body) {
    const name = cleanText(body.team_name, 60);
    if (!name) return fail("A team name is required.");
    update.team_name = name;
  }
  if ("athlete_1" in body) update.athlete_1 = cleanText(body.athlete_1, 80);
  if ("athlete_2" in body) update.athlete_2 = cleanText(body.athlete_2, 80);
  if ("division" in body) {
    const d = cleanText(body.division, 20);
    if (d && !DIVISIONS.includes(d)) return fail("Choose Men, Women or Mixed.");
    update.division = d;
  }
  if ("paid" in body) {
    if (typeof body.paid !== "boolean") return fail("Paid must be yes or no.");
    update.paid = body.paid;
  }
  if ("status" in body) {
    if (typeof body.status !== "string" || !STATUSES.includes(body.status)) return fail("That status isn't valid.");
    update.status = body.status;
  }

  let movingHeat = false;
  if ("wave" in body) {
    const w = body.wave;
    const wave = w === "" || w == null ? null : Number(w);
    if (wave != null && !Number.isInteger(wave)) return fail("Choose a heat.");
    if (wave !== current.wave) {
      movingHeat = true;
      update.wave = wave;
    }
  }

  if (Object.keys(update).length === 0) return json({ ok: true, id: params.id });

  if (movingHeat) {
    const { count: scanCount } = await admin
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("team_id", params.id);
    if ((scanCount ?? 0) > 0) {
      return fail("This team already has scans recorded, so it can't change heat.", 409);
    }

    const destWave = update.wave as number | null;
    let heat: { wave_number: number; scheduled_start: string } | null = null;
    if (destWave != null) {
      const { data, error: heatErr } = await admin
        .from("waves")
        .select("wave_number, scheduled_start, actual_start, actual_end")
        .eq("event_id", event.id)
        .eq("wave_number", destWave)
        .maybeSingle();
      if (heatErr) return dbFail(heatErr, "Couldn't check that heat.");
      if (!data) return fail(`Heat ${destWave} doesn't exist.`);
      // A team joining a running heat would start with time already on
      // its clock; joining an ended heat, every scan would be refused.
      if (data.actual_start) {
        return fail(`Heat ${destWave} has already ${data.actual_end ? "ended" : "started"} - pick a heat that hasn't started.`, 409);
      }
      heat = data;
    }

    // Keep the legacy start_time column pointed at the heat's plan.
    update.start_time = heat?.scheduled_start ?? `${event.event_date}T00:00:00`;

    if (event.team_id_scheme === "heat_position" && heat) {
      const { data: allTeams, error: allErr } = await admin.from("teams").select("id, wave").eq("event_id", event.id);
      if (allErr) return dbFail(allErr, "Couldn't load the teams.");
      const allIds = new Set((allTeams ?? []).map((t) => t.id));
      allIds.delete(params.id);
      const idsInHeat = (allTeams ?? []).filter((t) => t.wave === destWave && t.id !== params.id).map((t) => t.id);
      const newId = nextTeamId(heatIdPrefix(heat.scheduled_start, event.team_id_prefix), idsInHeat, allIds);
      update.id = newId;
      const nameToRename = (update.team_name as string | undefined) ?? current.team_name;
      update.team_name = renameForPosition(nameToRename, positionOf(newId));
    }
  }

  const { error } = await admin.from("teams").update(update).eq("id", params.id).eq("event_id", event.id);
  if (error) {
    if (error.code === "23505") return fail("That team name is already taken.", 409);
    return dbFail(error, "Couldn't save this team.");
  }

  if (movingHeat && event.team_id_scheme === "heat_position") {
    await autoFixTeamIds(event.id);
  }

  // Registration alert to the organisers when a team is withdrawn.
  if (update.status === "withdrawn" && current.status !== "withdrawn") {
    inBackground(() => sendAdminAlert(admin, event, params.id, "withdrawn"));
  }

  return json({ ok: true, id: (update.id as string | undefined) ?? params.id });
}

// Delete a team of the ACTIVE event. Only possible while it has no
// scans (the database refuses otherwise, RT002) - withdraw it instead.
// Its judge assignments go with it, and so does its team login (the
// link row and the login itself).
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const { data: team } = await admin
    .from("teams")
    .select("id")
    .eq("id", params.id)
    .eq("event_id", event.id)
    .maybeSingle();
  if (!team) return fail("That team isn't in the current event.", 404);

  const { count: scanCount } = await admin
    .from("scans")
    .select("id", { count: "exact", head: true })
    .eq("team_id", params.id);
  if ((scanCount ?? 0) > 0) {
    return fail("This team already has results recorded. Withdraw it instead of deleting it.", 409, {
      code: "RT002",
      canWithdraw: true,
    });
  }

  const { data: viewers } = await admin.from("team_viewers").select("id").eq("team_id", params.id);

  const { error } = await admin.from("teams").delete().eq("id", params.id).eq("event_id", event.id);
  if (error) return dbFail(error, "Couldn't delete this team.");

  // The team_viewers row went with the team (cascade); the login itself
  // lives in Supabase Auth and has to be removed separately.
  for (const v of viewers ?? []) await admin.auth.admin.deleteUser(v.id).catch(() => {});

  return json({ ok: true });
}
