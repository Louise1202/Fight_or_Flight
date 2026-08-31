import { buildSplits, getNextAction, Scan } from "./timing";
import { effectiveStartTime, hasWaveStarted, Wave } from "./waves";

export type TeamRow = {
  id: string;
  team_name: string;
  division: string | null;
  wave: number | null;
  start_time: string;
};

export type Standing = {
  team: TeamRow;
  status: "finished" | "in_progress" | "not_started";
  currentStationNumber: number;
  currentStationLabel: string;
  /** "arrive" means they're still running toward this station; "leave"
   * means they've arrived and are actually doing the exercise there.
   * null when not in progress (nothing meaningful to show). */
  currentEventType: "arrive" | "leave" | null;
  finalMs: number | null;
  lastUpdate: string | null;
  /** The real start time this team's clock actually runs from (wave's
   * actual_start once the admin has started that heat) - null if the
   * heat hasn't started yet, so there's nothing to count from. */
  startTime: string | null;
};

export function computeStandings(
  teams: TeamRow[],
  scansByTeam: Record<string, Scan[]>,
  penaltySecondsByTeam: Record<string, number>,
  wavesByNumber: Record<number, Wave> = {}
): Standing[] {
  const standings: Standing[] = teams.map((team) => {
    const scans = scansByTeam[team.id] ?? [];
    const penaltySeconds = penaltySecondsByTeam[team.id] ?? 0;
    const wave = team.wave != null ? wavesByNumber[team.wave] : undefined;
    const started = hasWaveStarted(wave);
    const startTime = effectiveStartTime(team.start_time, wave);

    // A heat that hasn't been started by the admin yet is "not started"
    // regardless of anything else - there's nothing to time. Once it HAS
    // started, a team counts as racing immediately - even before their
    // first scan, since their first leg is a 400m run before they ever
    // reach Station 1.
    if (!started) {
      return {
        team,
        status: "not_started" as const,
        currentStationNumber: 0,
        currentStationLabel: "Not started",
        currentEventType: null,
        finalMs: null,
        lastUpdate: null,
        startTime: null,
      };
    }

    const next = getNextAction(scans);
    const lastScan =
      scans.length > 0
        ? [...scans].sort(
            (a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime()
          )[0]
        : null;

    if (next.isFinished && lastScan) {
      const splits = buildSplits(scans, startTime);
      const finish = splits.find((s) => s.station === 13);
      const rawMs = finish?.arrivedAt
        ? new Date(finish.arrivedAt).getTime() - new Date(startTime).getTime()
        : null;
      return {
        team,
        status: "finished",
        currentStationNumber: 13,
        currentStationLabel: "Finished",
        currentEventType: null,
        finalMs: rawMs != null ? rawMs + penaltySeconds * 1000 : null,
        lastUpdate: lastScan.scanned_at,
        startTime,
      };
    }

    return {
      team,
      status: "in_progress",
      currentStationNumber: next.stationNumber,
      currentStationLabel: next.stationName,
      currentEventType: next.eventType,
      finalMs: null,
      // Before the first scan, "last activity" is the heat's own start -
      // that's what the staleness check on the admin monitor should
      // measure against (how long since this team began, with nothing
      // logged yet), rather than having nothing to compare against.
      lastUpdate: lastScan ? lastScan.scanned_at : startTime,
      startTime,
    };
  });

  const finished = standings
    .filter((s) => s.status === "finished")
    .sort((a, b) => (a.finalMs ?? 0) - (b.finalMs ?? 0));

  const inProgress = standings
    .filter((s) => s.status === "in_progress")
    .sort((a, b) => {
      if (b.currentStationNumber !== a.currentStationNumber) {
        return b.currentStationNumber - a.currentStationNumber; // further along first
      }
      return new Date(a.lastUpdate!).getTime() - new Date(b.lastUpdate!).getTime();
    });

  const notStarted = standings
    .filter((s) => s.status === "not_started")
    .sort((a, b) => {
      const waveA = a.team.wave != null ? wavesByNumber[a.team.wave] : undefined;
      const waveB = b.team.wave != null ? wavesByNumber[b.team.wave] : undefined;
      const timeA = new Date(effectiveStartTime(a.team.start_time, waveA)).getTime();
      const timeB = new Date(effectiveStartTime(b.team.start_time, waveB)).getTime();
      return timeA - timeB;
    });

  return [...finished, ...inProgress, ...notStarted];
}
