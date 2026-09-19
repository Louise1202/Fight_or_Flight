import { createAdminClient } from "@/lib/supabase/admin";
import { heatIdPrefix, renameForPosition } from "@/lib/teamId";

type TeamRow = { id: string; team_name: string; wave: number | null };

function parsedNumber(name: string): number {
  const m = name.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

/**
 * Recomputes what every team's id and name SHOULD be, trusting each
 * team's current heat assignment and the number in its own name (e.g.
 * "Team 08" -> position 8), not the digits already in its id.
 *
 * `apply` controls whether this actually writes anything:
 * - true (the default) - actually applies the fix. Only call this
 *   because of a deliberate action (a team was just moved, a heat's
 *   time was just changed, an Excel import just ran) - never on a
 *   plain page load. Running this merely because a page was viewed was
 *   exactly what caused ids to keep drifting out from under an admin
 *   who was mid-edit on a downloaded spreadsheet, with nothing having
 *   actually changed.
 * - false - a read-only dry run. Returns the same shape (updated,
 *   orphaned, duplicateNames) for display, but never writes anything.
 *   This is what a plain page load should use.
 *
 * A whole heat is skipped entirely the moment ANY team in it has a scan
 * recorded, so applying this can never touch live race data, only
 * pre-race setup.
 */
export async function autoFixTeamIds(apply: boolean = true): Promise<{
  updated: number;
  orphaned: { id: string; team_name: string }[];
  duplicateNames: { name: string; wave: number; count: number }[];
}> {
  const admin = createAdminClient();
  const [{ data: teams }, { data: waves }, { data: scanRows }] = await Promise.all([
    // Ordered explicitly - without this, two teams with an identical
    // name (a real "Team 08" / "Team 08" duplicate has happened) have no
    // reliable tie-break, and their relative order - and therefore their
    // ids - could silently shuffle between one page load and the next.
    admin.from("teams").select("id, team_name, wave").order("id"),
    admin.from("waves").select("wave_number, scheduled_start"),
    admin.from("scans").select("team_id"),
  ]);

  const waveByNumber = new Map((waves ?? []).map((w) => [w.wave_number, w.scheduled_start]));
  const teamsWithScans = new Set((scanRows ?? []).map((s) => s.team_id));

  const byWave = new Map<number, TeamRow[]>();
  const orphaned: { id: string; team_name: string }[] = [];
  for (const t of (teams ?? []) as TeamRow[]) {
    if (t.wave == null || !waveByNumber.has(t.wave)) {
      // Its heat doesn't exist anymore - nothing to re-id it against.
      // This is the one thing that genuinely needs a human decision
      // (delete it, or assign it to a real heat), so it's just reported.
      orphaned.push({ id: t.id, team_name: t.team_name });
      continue;
    }
    const list = byWave.get(t.wave) ?? [];
    list.push(t);
    byWave.set(t.wave, list);
  }

  // A name is only actually ambiguous within the SAME heat - "Team 01"
  // existing once per heat is the intended design (a per-heat position
  // label), not a problem. Reusing a name across different heats is
  // completely normal.
  const duplicateNames: { name: string; wave: number; count: number }[] = [];
  for (const [wave, group] of byWave) {
    const counts = new Map<string, number>();
    for (const t of group) counts.set(t.team_name, (counts.get(t.team_name) ?? 0) + 1);
    for (const [name, count] of counts) {
      if (count > 1) duplicateNames.push({ name, wave, count });
    }
  }

  const plan: { oldId: string; newId: string; newName: string }[] = [];
  for (const [wave, group] of byWave) {
    if (group.some((t) => teamsWithScans.has(t.id))) continue; // this heat is live - leave it alone
    const sorted = [...group].sort((a, b) => {
      const na = parsedNumber(a.team_name);
      const nb = parsedNumber(b.team_name);
      if (na !== nb) return na - nb;
      if (a.team_name !== b.team_name) return a.team_name.localeCompare(b.team_name);
      // Identical names too - fall back to the team's own current id,
      // which is always unique, so the result never depends on
      // whatever order the database happened to return rows in.
      return a.id.localeCompare(b.id);
    });
    const prefix = heatIdPrefix(waveByNumber.get(wave)!);
    sorted.forEach((t, i) => {
      const position = i + 1;
      const newId = `${prefix}${String(position).padStart(2, "0")}`;
      const newName = renameForPosition(t.team_name, position);
      if (newId !== t.id || newName !== t.team_name) plan.push({ oldId: t.id, newId, newName });
    });
  }

  if (plan.length === 0) return { updated: 0, orphaned, duplicateNames };
  if (!apply) return { updated: plan.length, orphaned, duplicateNames };

  // Two-phase rename so no team can ever collide with another mid-run,
  // however tangled the starting point.
  for (const p of plan) {
    await admin.from("teams").update({ id: `TMP-${p.oldId}` }).eq("id", p.oldId);
  }
  for (const p of plan) {
    await admin.from("teams").update({ id: p.newId, team_name: p.newName }).eq("id", `TMP-${p.oldId}`);
  }

  return { updated: plan.length, orphaned, duplicateNames };
}
