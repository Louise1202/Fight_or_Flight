import { autoFixTeamIds } from "@/lib/rebuildTeamIds";
import { adminContext, fail, json, lockedFail } from "../_lib/guard";

export const dynamic = "force-dynamic";

// Re-derives Fight-or-Flight-style Team IDs (letters + heat time +
// position) for the ACTIVE event. Does nothing for sequential events
// (their ids are permanent), locked events, or heats that have started.

export async function GET() {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  try {
    const result = await autoFixTeamIds(ctx.event.id, false);
    return json({ scheme: ctx.event.team_id_scheme, wouldUpdate: result.updated, orphaned: result.orphaned });
  } catch {
    return fail("Couldn't check the Team IDs.", 500);
  }
}

export async function POST() {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  if (ctx.event.locked) return lockedFail();
  if (ctx.event.team_id_scheme !== "heat_position") {
    return json({ ok: true, updated: 0, note: "Team IDs in this event are permanent - nothing to rebuild." });
  }
  try {
    const result = await autoFixTeamIds(ctx.event.id, true);
    return json({ ok: true, updated: result.updated });
  } catch {
    return fail("Couldn't rebuild the Team IDs.", 500);
  }
}
