export type Wave = {
  wave_number: number;
  scheduled_start: string;
  actual_start: string | null;
  actual_end: string | null;
  event_id?: string;
  /** Why the heat ended: everyone finished, the time limit, or the admin. */
  end_reason?: "all_finished" | "time_limit" | "manual" | null;
};

export const WAVE_COLUMNS = "event_id, wave_number, scheduled_start, actual_start, actual_end, end_reason";

/**
 * The single source of truth for "when did this team's race actually
 * start" everywhere in the app (splits, live clocks, leaderboard, export).
 *
 * Priority: the admin's real actual_start > the wave's scheduled_start >
 * the team's own start_time field (a legacy fallback, only relevant to
 * scan data collected before this feature existed).
 */
export function effectiveStartTime(
  teamStartTime: string,
  wave: Wave | null | undefined
): string {
  return wave?.actual_start ?? wave?.scheduled_start ?? teamStartTime;
}

/** Whether this team's heat has actually been started by the admin yet. */
export function hasWaveStarted(wave: Wave | null | undefined): boolean {
  return !!wave?.actual_start;
}

/** Whether every team in this heat has finished (auto-detected, or the
 * admin manually closed it as a fallback for a DNF/withdrawal). */
export function hasWaveEnded(wave: Wave | null | undefined): boolean {
  return !!wave?.actual_end;
}
