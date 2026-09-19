import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";

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
  return `${t.wave}::${a1}::${a2}`;
}

async function findGroups() {
  const admin = createAdminClient();
  const { data: teams, error } = await admin
    .from("teams")
    .select("id, team_name, athlete_1, athlete_2, wave")
    .order("id");
  if (error) throw new Error(error.message);

  const { data: scanRows, error: scansErr } = await admin.from("scans").select("team_id");
  if (scansErr) throw new Error(scansErr.message);
  const teamsWithScans = new Set((scanRows ?? []).map((s) => s.team_id));

  const groups = new Map<string, Team[]>();
  for (const t of (teams ?? []) as Team[]) {
    // Nothing to compare without both athlete names - never flagged.
    if (!t.athlete_1 || !t.athlete_2 || t.wave == null) continue;
    const key = athletePairKey(t);
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const duplicateGroups: { keep: Team; remove: Team[]; hasScans: boolean }[] = [];
  for (const list of groups.values()) {
    if (list.length <= 1) continue;
    // Keep the earliest (lowest id, so lowest position) as the "real"
    // one - the rest are the leftover copies.
    const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
    const [keep, ...remove] = sorted;
    duplicateGroups.push({
      keep,
      remove,
      hasScans: list.some((t) => teamsWithScans.has(t.id)),
    });
  }

  return duplicateGroups;
}

export async function GET() {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  try {
    const groups = await findGroups();
    return NextResponse.json({ groups });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Deletes only the specific ids the admin has reviewed and sent back -
// never re-derives "what to delete" itself, so nothing new can slip in
// between the preview the admin looked at and what actually gets removed.
export async function POST(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { ids } = await req.json();
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "ids must be an array of team ids" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: scanRows } = await admin.from("scans").select("team_id").in("team_id", ids);
  const blocked = new Set((scanRows ?? []).map((s) => s.team_id));

  let deleted = 0;
  const skipped: string[] = [];
  for (const id of ids) {
    if (blocked.has(id)) {
      skipped.push(id);
      continue;
    }
    const { data: viewer } = await admin.from("team_viewers").select("id").eq("team_id", id).maybeSingle();
    if (viewer) {
      await admin.from("team_viewers").delete().eq("id", viewer.id);
      await admin.auth.admin.deleteUser(viewer.id).catch(() => {});
    }
    const { error } = await admin.from("teams").delete().eq("id", id);
    if (!error) deleted++;
  }

  return NextResponse.json({ ok: true, deleted, skipped });
}
