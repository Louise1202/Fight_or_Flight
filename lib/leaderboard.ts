import { buildSplits, getNextAction, Scan } from "./timing";

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
  finalMs: number | null;
  lastUpdate: string | null;
};

export function computeStandings(
  teams: TeamRow[],
  scansByTeam: Record<string, Scan[]>,
  penaltySecondsByTeam: Record<string, number>
): Standing[] {
  const standings: Standing[] = teams.map((team) => {
    const scans = scansByTeam[team.id] ?? [];
    const penaltySeconds = penaltySecondsByTeam[team.id] ?? 0;

    if (scans.length === 0) {
      return {
        team,
        status: "not_started",
        currentStationNumber: 0,
        currentStationLabel: "Not started",
        finalMs: null,
        lastUpdate: null,
      };
    }

    const next = getNextAction(scans);
    const lastScan = [...scans].sort(
      (a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime()
    )[0];

    if (next.isFinished) {
      const splits = buildSplits(scans, team.start_time);
      const finish = splits.find((s) => s.station === 13);
      const rawMs = finish?.arrivedAt
        ? new Date(finish.arrivedAt).getTime() - new Date(team.start_time).getTime()
        : null;
      return {
        team,
        status: "finished",
        currentStationNumber: 13,
        currentStationLabel: "Finished",
        finalMs: rawMs != null ? rawMs + penaltySeconds * 1000 : null,
        lastUpdate: lastScan.scanned_at,
      };
    }

    return {
      team,
      status: "in_progress",
      currentStationNumber: next.stationNumber,
      currentStationLabel: next.stationName,
      finalMs: null,
      lastUpdate: lastScan.scanned_at,
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
    .sort(
      (a, b) => new Date(a.team.start_time).getTime() - new Date(b.team.start_time).getTime()
    );

  return [...finished, ...inProgress, ...notStarted];
}
