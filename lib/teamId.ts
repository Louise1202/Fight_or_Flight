// Team IDs follow the scheme "FF" + the heat's start time as HHMM (no
// colon) + a 2-digit position number that resets to 01 at the start of
// each heat. e.g. the 3rd team in the 07:30 heat is FF073003.
//
// Historically these came straight from the "Team ID" column of an
// imported Excel sheet. When a team is built in the app instead, the id
// is generated here following the same scheme.
//
// The HHMM part is read from the heat's scheduled_start using its UTC
// wall-clock components - this matches how the rest of the app treats
// that column (app/api/admin/import/route.ts writes `${date}T${HH}:${MM}`
// with no timezone; AdminDashboard.startEditSchedule reads getUTCHours()).

/** "FF" + HHMM of the heat's scheduled start (e.g. "FF0730"). */
export function heatIdPrefix(scheduledStart: string): string {
  const d = new Date(scheduledStart);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `FF${hh}${mm}`;
}

/** The trailing position number of a team id, or 0 if it doesn't parse. */
export function positionOf(teamId: string): number {
  const digits = teamId.replace(/^FF\d{4}/, "");
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The next team id for a heat: its prefix + (highest existing position in
 * that heat + 1), zero-padded to 2 digits. Append-at-end - a position is
 * never reused, even after a delete.
 *
 * `idsInHeat` is every existing team id already in the destination heat.
 * `allIds` is every team id in the event, used only to step past a
 * cross-heat collision (two heats scheduled at the same HH:MM would share
 * a prefix).
 */
export function nextTeamId(
  prefix: string,
  idsInHeat: string[],
  allIds: Set<string>
): string {
  const highest = idsInHeat.reduce((max, id) => Math.max(max, positionOf(id)), 0);
  let position = highest + 1;
  let candidate = `${prefix}${String(position).padStart(2, "0")}`;
  while (allIds.has(candidate)) {
    position += 1;
    candidate = `${prefix}${String(position).padStart(2, "0")}`;
  }
  return candidate;
}
