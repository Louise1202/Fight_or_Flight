import { NextRequest } from "next/server";
import { heatIdPrefix, nextTeamId } from "@/lib/teamId";
import { adminContext, cleanText, dbFail, fail, json, lockedFail, readBody } from "../_lib/guard";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";

const DIVISIONS = ["Men", "Women", "Mixed"];

// Add a team to the ACTIVE event by hand. The admin never types the id:
// - sequential events: the next permanent id from the database
//   (allocate_team_id, same numbering as online sign-up). A heat is optional.
// - heat_position events: letters + heat time + next position in that heat.
export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  if (!body) return fail("Please fill in the form and try again.");

  const teamName = cleanText(body.team_name, 60);
  if (!teamName) return fail("A team name is required.");
  const division = cleanText(body.division, 20);
  if (division && !DIVISIONS.includes(division)) return fail("Choose Men, Women or Mixed.");

  const rawWave = body.wave;
  const wave = rawWave === "" || rawWave == null ? null : Number(rawWave);
  if (wave != null && !Number.isInteger(wave)) return fail("Choose a heat.");
  if (wave == null && event.team_id_scheme === "heat_position") return fail("Choose a heat for this team.");

  let heat: { wave_number: number; scheduled_start: string } | null = null;
  if (wave != null) {
    const { data, error: heatErr } = await admin
      .from("waves")
      .select("wave_number, scheduled_start")
      .eq("event_id", event.id)
      .eq("wave_number", wave)
      .maybeSingle();
    if (heatErr) return dbFail(heatErr, "Couldn't check that heat.");
    if (!data) return fail(`Heat ${wave} doesn't exist.`);
    heat = data;
  }

  // Friendly early check (before an id is used up); the database enforces
  // it as well. Skipped for names with "*" (a wildcard in this filter).
  if (event.team_id_scheme === "sequential" && !teamName.includes("*")) {
    const { data: sameName } = await admin
      .from("teams")
      .select("id")
      .eq("event_id", event.id)
      .neq("status", "withdrawn")
      .ilike("team_name", teamName.replace(/[%_\\]/g, "\\$&"))
      .limit(1);
    if ((sameName ?? []).length > 0) return fail("That team name is already taken.", 409);
  }

  let id: string;
  if (event.team_id_scheme === "sequential") {
    const { data: allocated, error: allocErr } = await admin.rpc("allocate_team_id", { p_event_id: event.id });
    if (allocErr || typeof allocated !== "string") return dbFail(allocErr, "Couldn't give the team an ID - try again.");
    id = allocated;
  } else {
    const { data: existing, error: teamsErr } = await admin.from("teams").select("id, wave").eq("event_id", event.id);
    if (teamsErr) return dbFail(teamsErr, "Couldn't load the teams.");
    const allIds = new Set((existing ?? []).map((t) => t.id));
    const idsInHeat = (existing ?? []).filter((t) => t.wave === wave).map((t) => t.id);
    id = nextTeamId(heatIdPrefix(heat!.scheduled_start, event.team_id_prefix), idsInHeat, allIds);
  }

  const row = {
    id,
    event_id: event.id,
    team_name: teamName,
    athlete_1: cleanText(body.athlete_1, 80),
    athlete_2: cleanText(body.athlete_2, 80),
    division,
    wave,
    // Legacy fallback column; the real race clock comes from the heat.
    start_time: heat?.scheduled_start ?? `${event.event_date}T00:00:00`,
    status: "confirmed",
    registered_at: new Date().toISOString(),
  };

  const { error } = await admin.from("teams").insert(row);
  if (error) {
    if (error.code === "23505") return fail("That team name is already taken.", 409);
    return dbFail(error, "Couldn't add the team.");
  }

  return json({ ok: true, team: { ...row, paid: false } });
}
