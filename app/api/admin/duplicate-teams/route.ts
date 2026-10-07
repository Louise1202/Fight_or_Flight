import { NextRequest } from "next/server";
import { fetchEventScans } from "@/lib/activeEvent";
import { adminContext, AdminClient, dbFail, fail, json, lockedFail, readBody } from "../_lib/guard";

export const dynamic = "force-dynamic";

type Team = {
  id: string;
  team_name: string;
  athlete_1: string | null;
  athlete_2: string | null;
  wave: number | null;
};

function athletePairKey(t: Team): string {
  const a1 = (t.athlete_1 ?? "").trim().toLowerCase();
  const a2 = (t.athlete_2 ?? "").trim().toLowerCase();
  return `${t.wave ?? "none"}::${a1}::${a2}`;
}

async function findGroups(admin: AdminClient, eventId: string) {
  const { data: teams, error } = await admin
    .from("teams")
    .select("id, team_name, athlete_1, athlete_2, wave")
    .eq("event_id", eventId)
    .neq("status", "withdrawn")
    .order("id");
  if (error) throw new Error("teams");

  const scans = await fetchEventScans(eventId, admin);
  const teamsWithScans = new Set(scans.map((s) => s.team_id));

  const groups = new Map<string, Team[]>();
  for (const t of (teams ?? []) as Team[]) {
    // Nothing to compare without both athlete names - never flagged.
    if (!t.athlete_1 || !t.athlete_2) continue;
    const key = athletePairKey(t);
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const duplicateGroups: { keep: Team; remove: Team[]; hasScans: boolean }[] = [];
  for (const list of groups.values()) {
    if (list.length <= 1) continue;
    // Keep the earliest (lowest id) as the real one.
    const [keep, ...remove] = [...list].sort((a, b) => a.id.localeCompare(b.id));
    duplicateGroups.push({ keep, remove, hasScans: list.some((t) => teamsWithScans.has(t.id)) });
  }
  return duplicateGroups;
}

export async function GET() {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  try {
    const groups = await findGroups(ctx.admin, ctx.event.id);
    return json({ groups });
  } catch {
    return fail("Couldn't check for duplicates - try again.", 500);
  }
}

// Deletes only the specific ids the admin reviewed and sent back, only
// from the ACTIVE event, and never a team with a scan.
export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500 || ids.some((id) => typeof id !== "string")) {
    return fail("Nothing selected to delete.");
  }

  const { data: inEvent, error: evErr } = await admin
    .from("teams")
    .select("id")
    .eq("event_id", event.id)
    .in("id", ids as string[]);
  if (evErr) return dbFail(evErr, "Couldn't check those teams.");
  const allowed = new Set((inEvent ?? []).map((t) => t.id));
  if (allowed.size === 0) return fail("Those teams aren't in the current event.");

  const { data: scanRows } = await admin.from("scans").select("team_id").in("team_id", [...allowed]);
  const blocked = new Set((scanRows ?? []).map((s) => s.team_id));

  let deleted = 0;
  const skipped: string[] = [];
  for (const id of ids as string[]) {
    if (!allowed.has(id) || blocked.has(id)) {
      skipped.push(id);
      continue;
    }
    const { data: viewers } = await admin.from("team_viewers").select("id").eq("team_id", id);
    const { error } = await admin.from("teams").delete().eq("id", id).eq("event_id", event.id);
    if (error) {
      skipped.push(id);
      continue;
    }
    deleted++;
    // The team_viewers row went with the team (cascade); remove the login itself too.
    for (const v of viewers ?? []) await admin.auth.admin.deleteUser(v.id).catch(() => {});
  }

  return json({ ok: true, deleted, skipped });
}
