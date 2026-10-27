import { NextRequest } from "next/server";
import { cleanPersonName, cleanTeamName, isReservedTeamName, TEAM_NAME_MAX } from "@/components/register/rules";
import { adminContext, dbFail, fail, json, lockedFail, readBody, teamInEvent } from "../../_lib/guard";

// Admin: change a team's name and/or its athletes' names.
//   PATCH { teamId, team_name?, members?: [{ position: 1|2, first_name, surname }] }
// Same rules as sign-up. Names are written to BOTH places they are kept
// (team_members and teams.athlete_1/2) by admin_set_team_names (sql/024).
// Only names change - payments, heats, signatures and contact details stay.
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  const teamId = typeof body?.teamId === "string" ? body.teamId : "";
  if (!teamId) return fail("Choose a team.");
  const team = await teamInEvent(admin, teamId, event.id);
  if (!team) return fail("That team isn't in the current event.", 404);

  // Team name (optional). Blank means the default "Team <Team ID>".
  let teamName: string | null = null;
  if (body && "team_name" in body) {
    const cleaned = cleanTeamName(body.team_name);
    if (cleaned === null) return fail(`Team names can be at most ${TEAM_NAME_MAX} characters, without < or >.`);
    const own = `Team ${teamId}`;
    teamName = cleaned || own;
    if (isReservedTeamName(teamName) && teamName.replace(/\s+/g, "").toLowerCase() !== own.replace(/\s+/g, "").toLowerCase()) {
      return fail(`Names like "Team SV001" are kept for teams without a name. Leave it blank to use "${own}".`);
    }
    if (teamName === team.team_name) teamName = null; // unchanged
  }

  // Athlete names (optional).
  const names: { position: 1 | 2; first_name: string; surname: string }[] = [];
  if (body && Array.isArray(body.members)) {
    for (const raw of body.members) {
      if (!raw || typeof raw !== "object") return fail("Check the athlete names.");
      const r = raw as Record<string, unknown>;
      const position = r.position === 1 || r.position === 2 ? r.position : null;
      if (!position) return fail("Check the athlete names.");
      const first = cleanPersonName(r.first_name);
      const surname = cleanPersonName(r.surname);
      if (!first || !surname) {
        return fail(`Athlete ${position}: use letters, spaces, apostrophes or hyphens only, and fill in both names.`);
      }
      names.push({ position, first_name: first, surname });
    }
  }
  if (teamName === null && names.length === 0) return json({ ok: true, unchanged: true });

  if (teamName !== null) {
    // Friendly check first; the unique index is the real guard.
    const { data: same } = await admin
      .from("teams")
      .select("id, team_name")
      .eq("event_id", event.id)
      .neq("status", "withdrawn")
      .neq("id", teamId)
      .ilike("team_name", teamName.replace(/[\\%_]/g, (c) => `\\${c}`));
    const clash = (same ?? []).find((t) => (t.team_name ?? "").trim().toLowerCase() === teamName!.trim().toLowerCase());
    if (clash) return fail(`"${teamName}" is already used by ${clash.id}. Choose another name.`, 409);
  }

  const { error } = await admin.rpc("admin_set_team_names", {
    p_team_id: teamId,
    p_team_name: teamName,
    p_names: names,
  });
  if (error) {
    if (error.code === "23505") return fail("That team name is already taken. Choose another name.", 409);
    return dbFail(error, "Couldn't save the names.");
  }

  const { data: saved } = await admin
    .from("teams")
    .select("id, team_name, athlete_1, athlete_2")
    .eq("id", teamId)
    .maybeSingle();
  return json({ ok: true, team: saved });
}
