// The fixed station sequence, from the Race Format sheet.
// Station 13 is the finish line itself - only an "arrive" scan is
// logged there (no "leave"), so the same {station_number, event_type}
// shape works for the whole course without a separate table.
export const STATIONS = [
  { number: 1, name: "KB Farmers Carry" },
  { number: 2, name: "KB Deadlift" },
  { number: 3, name: "DB Lunges" },
  { number: 4, name: "DB Snatch" },
  { number: 5, name: "Burpee Broad Jumps" },
  { number: 6, name: "KB Goblet Squat" },
  { number: 7, name: "Weight Plate Front Carry" },
  { number: 8, name: "DB Push Press" },
  { number: 9, name: "Bear Crawl" },
  { number: 10, name: "Weight Plate Clean and Press" },
  { number: 11, name: "Weight Plate Overhead Carry" },
  { number: 12, name: "DB Devil Press" },
  { number: 13, name: "FINISH" },
] as const;

export type Scan = {
  station_number: number;
  event_type: "arrive" | "leave";
  scanned_at: string;
};

export type NextAction = {
  stationNumber: number;
  stationName: string;
  eventType: "arrive" | "leave";
  label: string;
  isFinished: boolean;
};

/**
 * Given every scan logged for a team so far, work out what the judge's
 * next scan should be. Judges never pick this manually - it's inferred
 * purely from what's already been logged, so there's nothing to get
 * wrong on a fast-moving race day.
 */
export function getNextAction(scans: Scan[]): NextAction {
  const sorted = [...scans].sort(
    (a, b) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime()
  );
  const last = sorted[sorted.length - 1];

  if (!last) {
    const station = STATIONS[0];
    return {
      stationNumber: station.number,
      stationName: station.name,
      eventType: "arrive",
      label: `Arrive - Station 1: ${station.name}`,
      isFinished: false,
    };
  }

  if (last.station_number === 13 && last.event_type === "arrive") {
    return {
      stationNumber: 13,
      stationName: "FINISH",
      eventType: "arrive",
      label: "Finished",
      isFinished: true,
    };
  }

  if (last.event_type === "arrive") {
    const station = STATIONS.find((s) => s.number === last.station_number)!;
    return {
      stationNumber: station.number,
      stationName: station.name,
      eventType: "leave",
      label: `Leave - Station ${station.number}: ${station.name}`,
      isFinished: false,
    };
  }

  // last event was "leave" - next is "arrive" at the next station
  const nextStation = STATIONS.find((s) => s.number === last.station_number + 1)!;
  return {
    stationNumber: nextStation.number,
    stationName: nextStation.name,
    eventType: "arrive",
    label:
      nextStation.number === 13
        ? "Scan at the FINISH line"
        : `Arrive - Station ${nextStation.number}: ${nextStation.name}`,
    isFinished: false,
  };
}

export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Build a station-by-station split table from a team's raw scans. */
export function buildSplits(scans: Scan[], startTime: string) {
  const sorted = [...scans].sort(
    (a, b) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime()
  );
  const start = new Date(startTime).getTime();
  let cursor = start;

  return STATIONS.map((station) => {
    const arrive = sorted.find(
      (s) => s.station_number === station.number && s.event_type === "arrive"
    );
    const leave = sorted.find(
      (s) => s.station_number === station.number && s.event_type === "leave"
    );

    const runMs = arrive ? new Date(arrive.scanned_at).getTime() - cursor : null;
    const stationMs =
      arrive && leave
        ? new Date(leave.scanned_at).getTime() - new Date(arrive.scanned_at).getTime()
        : null;

    if (leave) cursor = new Date(leave.scanned_at).getTime();
    else if (arrive) cursor = new Date(arrive.scanned_at).getTime();

    return {
      station: station.number,
      name: station.name,
      runMs,
      stationMs,
      arrivedAt: arrive?.scanned_at ?? null,
      leftAt: leave?.scanned_at ?? null,
    };
  });
}

export type Leg = {
  label: string;
  ms: number | null;
};

/**
 * Flattens buildSplits() output into the actual sequence a team
 * physically does: 400m run, then a station, then another 400m run,
 * then the next station, and so on - each as its own numbered step with
 * its own time, rather than grouping a run together with the station it
 * leads into.
 */
export function buildLegs(splits: ReturnType<typeof buildSplits>): Leg[] {
  const legs: Leg[] = [];
  for (const s of splits) {
    if (!s.arrivedAt) continue;
    if (s.runMs != null) {
      legs.push({ label: "400m run", ms: s.runMs });
    }
    if (s.station === 13) {
      legs.push({ label: "Finish", ms: null });
    } else {
      legs.push({ label: s.name, ms: s.stationMs });
    }
  }
  return legs;
}
