import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { heatIdPrefix, nextTeamId } from "@/lib/teamId";

// Always dynamic - this hits the live database on every request and
// must never be statically pre-rendered at build time (a build-time DB
// call against real, ever-changing data is exactly what crashed the
// build once already).
export const dynamic = "force-dynamic";

// Create a team without needing an Excel import. The id is generated from
// the heat's scheduled time following the FF+HHMM+position scheme - the
// admin never types it. New teams are appended: they take the next free
// position in their heat, existing teams keep their ids.
export async function POST(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const body = await req.json();
  const wave = Number(body.wave);
  const teamName = typeof body.team_name === "string" ? body.team_name.trim() : "";

  if (!Number.isInteger(wave)) {
    return NextResponse.json({ error: "A heat is required" }, { status: 400 });
  }
  if (!teamName) {
    return NextResponse.json({ error: "A team name is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: heat, error: heatErr } = await admin
    .from("waves")
    .select("wave_number, scheduled_start")
    .eq("wave_number", wave)
    .maybeSingle();

  if (heatErr) return NextResponse.json({ error: heatErr.message }, { status: 500 });
  if (!heat) {
    return NextResponse.json({ error: `Heat ${wave} doesn't exist` }, { status: 400 });
  }

  const { data: existing, error: teamsErr } = await admin.from("teams").select("id, wave");
  if (teamsErr) return NextResponse.json({ error: teamsErr.message }, { status: 500 });

  const allIds = new Set((existing ?? []).map((t) => t.id));
  const idsInHeat = (existing ?? []).filter((t) => t.wave === wave).map((t) => t.id);
  const id = nextTeamId(heatIdPrefix(heat.scheduled_start), idsInHeat, allIds);

  const clean = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s === "" ? null : s;
  };

  const row = {
    id,
    team_name: teamName,
    athlete_1: clean(body.athlete_1),
    athlete_2: clean(body.athlete_2),
    division: clean(body.division),
    wave,
    // Keep the legacy fallback column coherent with the heat's plan - the
    // real race clock always comes from waves.actual_start anyway.
    start_time: heat.scheduled_start,
  };

  const { error } = await admin.from("teams").insert(row);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, team: row });
}
