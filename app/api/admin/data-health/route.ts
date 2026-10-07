import { adminContext, dbFail, json } from "../_lib/guard";
import { heatIdPrefix, positionOf } from "@/lib/teamId";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";

// Read-only check of the ACTIVE event's teams against its heats.
export async function GET() {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;

  const [{ data: teams, error: teamsErr }, { data: waves, error: wavesErr }] = await Promise.all([
    admin.from("teams").select("id, team_name, wave").eq("event_id", event.id),
    admin.from("waves").select("wave_number, scheduled_start").eq("event_id", event.id),
  ]);
  if (teamsErr) return dbFail(teamsErr, "Couldn't load the teams.");
  if (wavesErr) return dbFail(wavesErr, "Couldn't load the heats.");

  const waveByNumber = new Map((waves ?? []).map((w) => [w.wave_number, w.scheduled_start]));
  const sequential = event.team_id_scheme === "sequential";

  const orphaned: { id: string; team_name: string; wave: number | null }[] = [];
  const stale: { id: string; team_name: string; wave: number; expectedId: string }[] = [];

  for (const t of teams ?? []) {
    if (t.wave == null) {
      // "No heat yet" is normal in a sequential event.
      if (!sequential) orphaned.push({ id: t.id, team_name: t.team_name, wave: t.wave });
      continue;
    }
    if (!waveByNumber.has(t.wave)) {
      orphaned.push({ id: t.id, team_name: t.team_name, wave: t.wave });
      continue;
    }
    // Sequential ids are permanent - they never go stale.
    if (sequential) continue;
    const expectedId = `${heatIdPrefix(waveByNumber.get(t.wave)!, event.team_id_prefix)}${String(positionOf(t.id)).padStart(2, "0")}`;
    if (expectedId !== t.id) stale.push({ id: t.id, team_name: t.team_name, wave: t.wave, expectedId });
  }

  const allIds = new Set((teams ?? []).map((t) => t.id));
  const wouldConflict = stale
    .filter((s) => allIds.has(s.expectedId))
    .map((s) => `${s.id} needs to become ${s.expectedId}, which is already used by another team`);

  return json({ eventId: event.id, orphaned, stale, wouldConflict });
}
