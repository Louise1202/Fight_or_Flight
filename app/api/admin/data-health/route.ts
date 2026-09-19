import { NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { heatIdPrefix, positionOf } from "@/lib/teamId";

// Always dynamic - this hits the live database on every request and
// must never be statically pre-rendered at build time.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const [{ data: teams, error: teamsErr }, { data: waves, error: wavesErr }] = await Promise.all([
    admin.from("teams").select("id, team_name, wave"),
    admin.from("waves").select("wave_number, scheduled_start"),
  ]);
  if (teamsErr) return NextResponse.json({ error: teamsErr.message }, { status: 500 });
  if (wavesErr) return NextResponse.json({ error: wavesErr.message }, { status: 500 });

  const waveByNumber = new Map((waves ?? []).map((w) => [w.wave_number, w.scheduled_start]));

  const orphaned: { id: string; team_name: string; wave: number | null }[] = [];
  const stale: { id: string; team_name: string; wave: number; expectedId: string }[] = [];

  for (const t of teams ?? []) {
    if (t.wave == null || !waveByNumber.has(t.wave)) {
      // Its wave was deleted (or it never had one), but the team row
      // itself was never cleaned up - this is exactly the kind of row
      // that silently blocks another team's id from becoming free.
      orphaned.push({ id: t.id, team_name: t.team_name, wave: t.wave });
      continue;
    }
    const expectedId = `${heatIdPrefix(waveByNumber.get(t.wave)!)}${String(positionOf(t.id)).padStart(2, "0")}`;
    if (expectedId !== t.id) {
      stale.push({ id: t.id, team_name: t.team_name, wave: t.wave, expectedId });
    }
  }

  // A stale team can only actually self-heal (by re-saving its heat's
  // time) if nothing else already holds the id it needs to become -
  // flag that up front too, rather than let the admin discover it by
  // trying and hitting the same "duplicate key" wall again.
  const allIds = new Set((teams ?? []).map((t) => t.id));
  const wouldConflict = stale
    .filter((s) => allIds.has(s.expectedId))
    .map((s) => `${s.id} needs to become ${s.expectedId}, which is already used by another team`);

  return NextResponse.json({ orphaned, stale, wouldConflict });
}
