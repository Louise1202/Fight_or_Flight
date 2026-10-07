// SERVER-ONLY.
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getEventById } from "@/lib/activeEvent";
import { chunk } from "@/lib/fetchAll";
import { heatIdPrefix, renameForPosition } from "@/lib/teamId";

type TeamRow = { id: string; team_name: string; wave: number | null; status?: string | null };

function parsedNumber(name: string): number {
  const m = name.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

export type AutoFixResult = {
  updated: number;
  /** Teams pointing at a heat number that doesn't exist in their event. */
  orphaned: { id: string; team_name: string }[];
  /** Same name used twice in the same heat (heat_position events only). */
  duplicateNames: { name: string; wave: number; count: number }[];
};

/**
 * Recomputes what every team's id and name SHOULD be in a 'heat_position'
 * event (FF + HHMM + position), trusting each team's current heat and the
 * number in its own name (e.g. "Team 08" -> position 8), not the digits
 * already in its id.
 *
 * Only ever touches ONE event (`eventId`, or the active event when left
 * out). Does nothing at all for a 'sequential' event (those ids are
 * permanent) or a locked one, and never touches a heat that has started
 * or that has any team with a scan.
 *
 * `apply`:
 * - true (the default) - writes the fix. Only after a deliberate action
 *   (a team moved, a heat's time changed, a spreadsheet uploaded) - never
 *   on a plain page load.
 * - false - a read-only dry run with the same result shape.
 */
export async function autoFixTeamIds(eventId?: string, apply: boolean = true): Promise<AutoFixResult> {
  const admin = createAdminClient();
  const event = eventId ? await getEventById(eventId, admin) : await getActiveEvent(admin);
  if (!event) return { updated: 0, orphaned: [], duplicateNames: [] };

  const [{ data: teams }, { data: waves }] = await Promise.all([
    // Ordered explicitly so ties never shuffle between runs.
    admin.from("teams").select("id, team_name, wave, status").eq("event_id", event.id).order("id"),
    admin.from("waves").select("wave_number, scheduled_start, actual_start").eq("event_id", event.id),
  ]);

  const waveByNumber = new Map((waves ?? []).map((w) => [w.wave_number as number, w]));

  const byWave = new Map<number, TeamRow[]>();
  const orphaned: { id: string; team_name: string }[] = [];
  for (const t of (teams ?? []) as TeamRow[]) {
    if (t.wave == null) {
      // In a sequential event "no heat yet" is normal, not a problem.
      if (event.team_id_scheme === "heat_position") orphaned.push({ id: t.id, team_name: t.team_name });
      continue;
    }
    if (!waveByNumber.has(t.wave)) {
      orphaned.push({ id: t.id, team_name: t.team_name });
      continue;
    }
    const list = byWave.get(t.wave) ?? [];
    list.push(t);
    byWave.set(t.wave, list);
  }

  // Sequential events: names are unique per event (the database enforces
  // it), ids never change - nothing more to check.
  if (event.team_id_scheme !== "heat_position") {
    return { updated: 0, orphaned, duplicateNames: [] };
  }

  // A name is only ambiguous within the SAME heat - "Team 01" once per
  // heat was the intended design for Fight or Flight.
  const duplicateNames: { name: string; wave: number; count: number }[] = [];
  for (const [wave, group] of byWave) {
    const counts = new Map<string, number>();
    for (const t of group) counts.set(t.team_name, (counts.get(t.team_name) ?? 0) + 1);
    for (const [name, count] of counts) {
      if (count > 1) duplicateNames.push({ name, wave, count });
    }
  }

  // A locked event can't change at all - report only, never load scans.
  if (event.locked) return { updated: 0, orphaned, duplicateNames };

  // Heats that haven't started are the only candidates. Scans are only
  // looked up for teams in those heats (not the whole event).
  const candidateWaves = [...byWave.keys()].filter((w) => !waveByNumber.get(w)?.actual_start);
  const candidateIds = candidateWaves.flatMap((w) => byWave.get(w)!.map((t) => t.id));
  const teamsWithScans = new Set<string>();
  for (const ids of chunk(candidateIds)) {
    const { data: scanRows } = await admin.from("scans").select("team_id").in("team_id", ids);
    for (const s of scanRows ?? []) teamsWithScans.add(s.team_id);
  }

  const plan: { oldId: string; newId: string; newName: string }[] = [];
  for (const wave of candidateWaves) {
    const group = byWave.get(wave)!;
    if (group.some((t) => teamsWithScans.has(t.id))) continue; // live data - leave it alone
    const sorted = [...group].sort((a, b) => {
      const na = parsedNumber(a.team_name);
      const nb = parsedNumber(b.team_name);
      if (na !== nb) return na - nb;
      if (a.team_name !== b.team_name) return a.team_name.localeCompare(b.team_name);
      return a.id.localeCompare(b.id);
    });
    const prefix = heatIdPrefix(waveByNumber.get(wave)!.scheduled_start, event.team_id_prefix);
    sorted.forEach((t, i) => {
      const position = i + 1;
      const newId = `${prefix}${String(position).padStart(2, "0")}`;
      const newName = renameForPosition(t.team_name, position);
      if (newId !== t.id || newName !== t.team_name) plan.push({ oldId: t.id, newId, newName });
    });
  }

  if (plan.length === 0) return { updated: 0, orphaned, duplicateNames };
  if (!apply) return { updated: plan.length, orphaned, duplicateNames };

  // Two-phase rename so no team can collide with another mid-run.
  for (const p of plan) {
    await admin.from("teams").update({ id: `TMP-${p.oldId}` }).eq("id", p.oldId).eq("event_id", event.id);
  }
  for (const p of plan) {
    await admin
      .from("teams")
      .update({ id: p.newId, team_name: p.newName })
      .eq("id", `TMP-${p.oldId}`)
      .eq("event_id", event.id);
  }

  return { updated: plan.length, orphaned, duplicateNames };
}
