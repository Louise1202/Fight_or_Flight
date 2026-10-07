// Pure standings logic - no database access, safe to import from browser
// code. The server-side loader that feeds it lives in
// components/results/data.ts.
import { buildSplits, getNextAction, Scan } from "./timing";
import { effectiveStartTime, hasWaveStarted, hasWaveEnded, Wave } from "./waves";
import { StationDef, realStationIndex } from "./stations";

export type TeamRow = {
  id: string;
  team_name: string;
  athlete_1?: string | null;
  athlete_2?: string | null;
  division: string | null;
  wave: number | null;
  start_time: string;
  stopped_note?: string | null;
  /** Registration status ('registered' | 'confirmed' | 'withdrawn').
   * Withdrawn teams are left out of the standings entirely. */
  status?: string | null;
};

export type Standing = {
  team: TeamRow;
  status: "finished" | "in_progress" | "stopped" | "not_started";
  currentStationNumber: number;
  /** The number to actually SHOW - counts only real stations, never a
   * run. currentStationNumber is the raw one, still used for sorting
   * "who's further along" (it increases in the same order either way). */
  currentStationIndex: number;
  currentStationLabel: string;
  /** "arrive" means they're still running toward this station; "leave"
   * means they've arrived and are actually doing the exercise there.
   * null when not in progress / stopped (nothing meaningful to show). */
  currentEventType: "arrive" | "leave" | null;
  /** How many real stations the team has fully completed (left). */
  completedStations: number;
  /** Name of the last real station completed, or null if none yet. */
  lastCompletedStationName: string | null;
  /** Raw finish time - the clock alone, before any penalty is added.
   * null unless finished. */
  rawMs: number | null;
  /** Total penalty seconds applied. Always present (0 if none), so
   * finish + penalty always adds up to final on screen. */
  penaltySeconds: number;
  /** rawMs + penaltySeconds*1000 - the official time. null unless
   * finished. */
  finalMs: number | null;
  lastUpdate: string | null;
  /** The real start time this team's clock actually runs from (wave's
   * actual_start once the admin has started that heat) - null if the
   * heat hasn't started yet, so there's nothing to count from. */
  startTime: string | null;
  /** Set only when status is "stopped" - the moment the heat actually
   * ended. The frontend must diff against THIS, not the live clock. */
  stoppedAt: string | null;
  /** The judge's free-text note on exactly where the team was when the
   * heat ended, if one was saved. Only set when stopped. */
  stoppedNote: string | null;
};

function realStationName(stations: StationDef[], index1: number): string | null {
  if (index1 < 1) return null;
  const real = stations.filter((s) => !s.isRun).sort((a, b) => a.number - b.number);
  return real[index1 - 1]?.name ?? null;
}

/**
 * Standings for ONE event. `wavesByNumber` must contain only that event's
 * heats (heat numbers repeat across events).
 */
export function computeStandings(
  teams: TeamRow[],
  scansByTeam: Record<string, Scan[]>,
  penaltySecondsByTeam: Record<string, number>,
  wavesByNumber: Record<number, Wave> = {},
  stations: StationDef[]
): Standing[] {
  const standings: Standing[] = teams
    .filter((team) => team.status !== "withdrawn")
    .map((team) => {
      const scans = scansByTeam[team.id] ?? [];
      const penaltySeconds = penaltySecondsByTeam[team.id] ?? 0;
      const wave = team.wave != null ? wavesByNumber[team.wave] : undefined;
      const started = hasWaveStarted(wave);
      const startTime = effectiveStartTime(team.start_time, wave);

      // A heat that hasn't been started by the admin yet is "not started"
      // regardless of anything else - there's nothing to time.
      if (!started) {
        return {
          team,
          status: "not_started" as const,
          currentStationNumber: 0,
          currentStationIndex: 0,
          currentStationLabel: "Not started",
          currentEventType: null,
          completedStations: 0,
          lastCompletedStationName: null,
          rawMs: null,
          penaltySeconds,
          finalMs: null,
          lastUpdate: null,
          startTime: null,
          stoppedAt: null,
          stoppedNote: null,
        };
      }

      const next = getNextAction(scans, stations);
      const lastScan =
        scans.length > 0
          ? [...scans].sort((a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime())[0]
          : null;
      const currentStationIndex = realStationIndex(stations, next.stationNumber);
      const completedStations = Math.max(0, currentStationIndex - 1);
      const lastCompletedStationName = realStationName(stations, completedStations);

      if (next.isFinished && lastScan) {
        const splits = buildSplits(scans, startTime, stations);
        const finish = splits.find((s) => s.isFinish);
        const rawMs = finish?.arrivedAt
          ? new Date(finish.arrivedAt).getTime() - new Date(startTime).getTime()
          : null;
        return {
          team,
          status: "finished" as const,
          currentStationNumber: next.stationNumber,
          currentStationIndex,
          currentStationLabel: "Finished",
          currentEventType: null,
          completedStations,
          lastCompletedStationName,
          rawMs,
          penaltySeconds,
          finalMs: rawMs != null ? rawMs + penaltySeconds * 1000 : null,
          lastUpdate: lastScan.scanned_at,
          startTime,
          stoppedAt: null,
          stoppedNote: null,
        };
      }

      // The heat ended (time limit, or the admin ended it) before this
      // team reached the finish line - frozen exactly where they were.
      if (hasWaveEnded(wave)) {
        return {
          team,
          status: "stopped" as const,
          currentStationNumber: next.stationNumber,
          currentStationIndex,
          currentStationLabel: next.stationName,
          currentEventType: next.eventType,
          completedStations,
          lastCompletedStationName,
          rawMs: null,
          penaltySeconds,
          finalMs: null,
          lastUpdate: lastScan ? lastScan.scanned_at : startTime,
          startTime,
          stoppedAt: wave!.actual_end,
          stoppedNote: team.stopped_note ?? null,
        };
      }

      return {
        team,
        status: "in_progress" as const,
        currentStationNumber: next.stationNumber,
        currentStationIndex,
        currentStationLabel: next.stationName,
        currentEventType: next.eventType,
        completedStations,
        lastCompletedStationName,
        rawMs: null,
        penaltySeconds,
        finalMs: null,
        // Before the first scan, "last activity" is the heat's own start.
        lastUpdate: lastScan ? lastScan.scanned_at : startTime,
        startTime,
        stoppedAt: null,
        stoppedNote: null,
      };
    });

  const finished = standings
    .filter((s) => s.status === "finished")
    .sort((a, b) => (a.finalMs ?? Infinity) - (b.finalMs ?? Infinity));

  const inProgress = standings
    .filter((s) => s.status === "in_progress")
    .sort((a, b) => {
      if (b.currentStationNumber !== a.currentStationNumber) {
        return b.currentStationNumber - a.currentStationNumber; // further along first
      }
      return new Date(a.lastUpdate!).getTime() - new Date(b.lastUpdate!).getTime();
    });

  // Stopped: further along first; same place -> whoever got there first.
  const stopped = standings
    .filter((s) => s.status === "stopped")
    .sort((a, b) => {
      if (b.currentStationNumber !== a.currentStationNumber) return b.currentStationNumber - a.currentStationNumber;
      const ea = a.currentEventType === "leave" ? 1 : 0;
      const eb = b.currentEventType === "leave" ? 1 : 0;
      if (eb !== ea) return eb - ea;
      return new Date(a.lastUpdate!).getTime() - new Date(b.lastUpdate!).getTime();
    });

  const notStarted = standings
    .filter((s) => s.status === "not_started")
    .sort((a, b) => {
      const waveA = a.team.wave != null ? wavesByNumber[a.team.wave] : undefined;
      const waveB = b.team.wave != null ? wavesByNumber[b.team.wave] : undefined;
      const timeA = new Date(effectiveStartTime(a.team.start_time, waveA)).getTime();
      const timeB = new Date(effectiveStartTime(b.team.start_time, waveB)).getTime();
      return (timeA || 0) - (timeB || 0) || a.team.id.localeCompare(b.team.id);
    });

  return [...finished, ...inProgress, ...stopped, ...notStarted];
}

// ------------------------------------------------------------------
// Ranking and divisions
// ------------------------------------------------------------------

/** Anything shaped like a Standing - also the public version without athlete names. */
export type Rankable = Omit<Standing, "team"> & { team: { id: string; division: string | null } };

export type Ranks = {
  /** Rank among all finishers (ties share a rank). null if not finished. */
  overallRank: number | null;
  /** Rank among finishers of the same division. null if not finished. */
  divisionRank: number | null;
};

export type RankedStanding<T extends Rankable = Standing> = T & Ranks;

export type DivisionGroup<T extends Rankable = Standing> = { division: string; standings: RankedStanding<T>[] };

const DIVISION_ORDER = ["Men", "Women", "Mixed", "Kids"];
export const NO_DIVISION = "No division";

export function divisionOf(s: { team: { division: string | null } }): string {
  return s.team.division?.trim() || NO_DIVISION;
}

function assignRanks<T extends Rankable>(list: T[], set: (s: T, rank: number | null) => void) {
  let rank = 0;
  let prevMs: number | null = null;
  let seen = 0;
  for (const s of list) {
    if (s.status !== "finished" || s.finalMs == null) {
      set(s, null);
      continue;
    }
    seen++;
    if (prevMs == null || s.finalMs !== prevMs) rank = seen;
    prevMs = s.finalMs;
    set(s, rank);
  }
}

/** Adds overall and per-division ranks. Keeps the order computeStandings gave. */
export function rankStandings<T extends Rankable>(standings: T[]): RankedStanding<T>[] {
  const ranked: RankedStanding<T>[] = standings.map((s) => ({ ...s, overallRank: null, divisionRank: null }));
  assignRanks(ranked, (s, r) => (s.overallRank = r));
  const byDivision = new Map<string, RankedStanding<T>[]>();
  for (const s of ranked) {
    const d = divisionOf(s);
    const list = byDivision.get(d) ?? [];
    list.push(s);
    byDivision.set(d, list);
  }
  for (const list of byDivision.values()) assignRanks(list, (s, r) => (s.divisionRank = r));
  return ranked;
}

function divisionSortKey(d: string): number {
  const i = DIVISION_ORDER.indexOf(d);
  if (i !== -1) return i;
  return d === NO_DIVISION ? 1000 : 100;
}

/**
 * Standings grouped by division (Men, Women, Mixed, Kids, then anything
 * else), each with per-division ranks for finishers. Only divisions that
 * actually have teams are returned.
 */
export function groupByDivision<T extends Rankable>(standings: T[]): DivisionGroup<T>[] {
  const ranked = rankStandings(standings);
  const map = new Map<string, RankedStanding<T>[]>();
  for (const s of ranked) {
    const d = divisionOf(s);
    const list = map.get(d) ?? [];
    list.push(s);
    map.set(d, list);
  }
  return [...map.entries()]
    .map(([division, list]) => ({ division, standings: list }))
    .sort((a, b) => divisionSortKey(a.division) - divisionSortKey(b.division) || a.division.localeCompare(b.division));
}

/**
 * Where a stopped (or in-progress) team is, in words a spectator
 * understands - real station numbers only, never a run's number.
 * e.g. "after station 7 (Sled Push)", "at station 8 (Wall Balls)".
 */
export function whereText(s: Omit<Standing, "team">): string {
  if (s.status === "finished") return "Finished";
  if (s.status === "not_started") return "Not started";
  if (s.currentEventType === "leave") {
    // Arrived at a station but hadn't completed it.
    return `at station ${s.currentStationIndex} (${s.currentStationLabel})`;
  }
  return s.completedStations > 0
    ? `after station ${s.completedStations}${s.lastCompletedStationName ? ` (${s.lastCompletedStationName})` : ""}`
    : "before station 1";
}
