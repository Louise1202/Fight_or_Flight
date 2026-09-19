import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { heatIdPrefix, nextTeamId, positionOf, renameForPosition } from "@/lib/teamId";
import { autoFixTeamIds } from "@/lib/rebuildTeamIds";

// Always dynamic - this hits the live database on every request and
// must never be statically pre-rendered at build time (a build-time DB
// call against real, ever-changing data is exactly what crashed the
// build once already).
export const dynamic = "force-dynamic";

const EDITABLE_FIELDS = [
  "team_name",
  "athlete_1",
  "athlete_2",
  "division",
  "wave",
  "start_time",
] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const body = await req.json();
  const update: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) update[field] = body[field];
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Normalise the incoming wave to a number (or null) so we can compare it
  // to what's stored.
  if ("wave" in update) {
    const w = update.wave;
    update.wave = w === "" || w == null ? null : Number(w);
    if (update.wave != null && !Number.isInteger(update.wave)) {
      return NextResponse.json({ error: "Heat must be a number" }, { status: 400 });
    }
  }

  const { data: current, error: currentErr } = await admin
    .from("teams")
    .select("id, wave, team_name")
    .eq("id", params.id)
    .maybeSingle();
  if (currentErr) return NextResponse.json({ error: currentErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Team not found" }, { status: 404 });

  // Moving a team to a different heat re-generates its id (the HHMM prefix
  // and position both belong to the heat). The FK ON UPDATE CASCADE from
  // sql/013 carries the id change through to scans / penalties /
  // assignments / team_viewers.
  const movingHeat =
    "wave" in update && update.wave != null && update.wave !== current.wave;

  if (movingHeat) {
    const destWave = update.wave as number;

    // Guard: never re-id a team that already has timing data recorded
    // against a heat that has actually been started - that would corrupt
    // its splits. (During event build there are no scans, so this is
    // inert then.)
    const { count: scanCount } = await admin
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("team_id", params.id);
    if (scanCount && scanCount > 0) {
      return NextResponse.json(
        {
          error:
            "This team already has scans recorded - move it before the race, or clear its scans first.",
        },
        { status: 409 }
      );
    }

    const { data: heat, error: heatErr } = await admin
      .from("waves")
      .select("wave_number, scheduled_start")
      .eq("wave_number", destWave)
      .maybeSingle();
    if (heatErr) return NextResponse.json({ error: heatErr.message }, { status: 500 });
    if (!heat) {
      return NextResponse.json({ error: `Heat ${destWave} doesn't exist` }, { status: 400 });
    }

    const { data: allTeams, error: allErr } = await admin.from("teams").select("id, wave");
    if (allErr) return NextResponse.json({ error: allErr.message }, { status: 500 });

    const allIds = new Set((allTeams ?? []).map((t) => t.id));
    allIds.delete(params.id);
    const idsInHeat = (allTeams ?? [])
      .filter((t) => t.wave === destWave && t.id !== params.id)
      .map((t) => t.id);

    const newId = nextTeamId(heatIdPrefix(heat.scheduled_start), idsInHeat, allIds);
    update.id = newId;
    // Keep the legacy fallback column pointed at the new heat's plan.
    update.start_time = heat.scheduled_start;

    // The name's own position label needs to track the move too - "Team
    // 01" landing at position 9 in its new heat becomes "Team 09". Uses
    // whatever name this same request is already setting, if any,
    // otherwise the team's current name. A custom name with no number in
    // it is left completely untouched.
    const nameToRename = (update.team_name as string | undefined) ?? current.team_name;
    update.team_name = renameForPosition(nameToRename, positionOf(newId));
  }

  const { error } = await admin.from("teams").update(update).eq("id", params.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Closes the gap left behind in the OLD heat (everyone after this
  // team's old position there shifts down, id and name both) - this is
  // the same automatic fixer that runs on every admin page load, just
  // triggered right now instead of waiting for the next one.
  if (movingHeat) {
    await autoFixTeamIds();
  }

  return NextResponse.json({ ok: true, id: update.id ?? params.id });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  // Remove the team's own login first - we need its id to also delete the
  // Supabase Auth user, which the FK cascade can't do. Everything else
  // (scans, penalties, judge assignments) is cleared by ON DELETE CASCADE
  // when the team row goes.
  const { data: viewer } = await admin
    .from("team_viewers")
    .select("id")
    .eq("team_id", params.id)
    .maybeSingle();

  if (viewer) {
    await admin.from("team_viewers").delete().eq("id", viewer.id);
    await admin.auth.admin.deleteUser(viewer.id).catch(() => {});
  }

  const { error } = await admin.from("teams").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
