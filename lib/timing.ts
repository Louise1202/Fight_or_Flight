import { StationDef, withFinish, realStationIndex } from "./stations";

export type Scan = {
  station_number: number;
  event_type: "arrive" | "leave";
  scanned_at: string;
};

export type NextAction = {
  stationNumber: number;
  /** The number to actually SHOW a human - counts only real stations,
   * 1, 2, 3... never counting a run. stationNumber itself still matters
   * internally (it's the real primary key, used when recording a scan)
   * but is never what gets displayed. */
  displayNumber: number;
  stationName: string;
  eventType: "arrive" | "leave";
  label: string;
  isFinished: boolean;
  /**
   * The name of the run currently happening (e.g. "400m Run"), if any -
   * only ever set while eventType is "arrive" (i.e. between confirming
   * one real station and the next) AND a run station actually sits in
   * the gap between them on the stations list. A judge never confirms
   * this directly; it's purely for display. null whenever nothing is
   * currently running (at a real station, or the gap has no run in it).
   */
  runName: string | null;
};

/** Only the stations a judge actually scans - run stations are display-only. */
function realStations(stations: StationDef[]): StationDef[] {
  return stations.filter((s) => !s.isRun);
}

/** The run station (if any) strictly between two real station numbers. */
function runNameInGap(stations: StationDef[], afterNumber: number, beforeNumber: number): string | null {
  const found = stations.find((s) => s.isRun && s.number > afterNumber && s.number < beforeNumber);
  return found ? found.name : null;
}

/**
 * Given every scan logged for a team so far, work out what the judge's
 * next scan should be. Judges never pick this manually, and never scan
 * a run station directly - only real stations get an arrive/leave pair;
 * a run's time is always the automatic gap between two of those.
 */
export function getNextAction(scans: Scan[], stations: StationDef[]): NextAction {
  const checkpoints = realStations(stations);
  if (checkpoints.length === 0) {
    return {
      stationNumber: 0,
      displayNumber: 0,
      stationName: "No stations configured",
      eventType: "arrive",
      label: "No stations configured yet - add stations in /admin first",
      isFinished: false,
      runName: null,
    };
  }

  const maxStationNumber = stations.reduce((m, s) => Math.max(m, s.number), 0);
  const finishNumber = maxStationNumber + 1;

  const sorted = [...scans].sort(
    (a, b) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime()
  );
  const last = sorted[sorted.length - 1];

  if (!last) {
    const first = checkpoints[0];
    const displayNumber = realStationIndex(stations, first.number);
    return {
      stationNumber: first.number,
      displayNumber,
      stationName: first.name,
      eventType: "arrive",
      label: `Arrive - Station ${displayNumber}: ${first.name}`,
      isFinished: false,
      runName: runNameInGap(stations, 0, first.number),
    };
  }

  if (last.station_number === finishNumber && last.event_type === "arrive") {
    return {
      stationNumber: finishNumber,
      displayNumber: realStationIndex(stations, finishNumber),
      stationName: "FINISH",
      eventType: "arrive",
      label: "Finished",
      isFinished: true,
      runName: null,
    };
  }

  if (last.event_type === "arrive") {
    const station = checkpoints.find((s) => s.number === last.station_number);
    if (!station) {
      return {
        stationNumber: last.station_number,
        displayNumber: last.station_number,
        stationName: "Unknown station",
        eventType: "leave",
        label: `This team's last scan was at station ${last.station_number}, which doesn't match the current station list - check with the race organizer.`,
        isFinished: false,
        runName: null,
      };
    }
    const displayNumber = realStationIndex(stations, station.number);
    return {
      stationNumber: station.number,
      displayNumber,
      stationName: station.name,
      eventType: "leave",
      label: `Leave - Station ${displayNumber}: ${station.name}`,
      isFinished: false,
      runName: null,
    };
  }

  // last was "leave" at a real station - find the next real station,
  // skipping over any run station(s) in between, or the finish line if
  // none remain.
  const nextCheckpoint = checkpoints.find((s) => s.number > last.station_number);
  if (!nextCheckpoint) {
    // Nothing real left - the finish line is next.
    return {
      stationNumber: finishNumber,
      displayNumber: realStationIndex(stations, finishNumber),
      stationName: "FINISH",
      eventType: "arrive",
      label: "Scan at the FINISH line",
      isFinished: false,
      runName: runNameInGap(stations, last.station_number, finishNumber),
    };
  }
  const displayNumber = realStationIndex(stations, nextCheckpoint.number);
  return {
    stationNumber: nextCheckpoint.number,
    displayNumber,
    stationName: nextCheckpoint.name,
    eventType: "arrive",
    label: `Arrive - Station ${displayNumber}: ${nextCheckpoint.name}`,
    isFinished: false,
    runName: runNameInGap(stations, last.station_number, nextCheckpoint.number),
  };
}

/**
 * How long the team has been on whatever they're doing right now: time
 * since they arrived, if they're at a real station (event_type "leave"
 * is next); or time since their last scan if they're currently running
 * (whether or not that run has a name) toward the next one. Returns
 * null once finished.
 */
export function getCurrentLegElapsedMs(
  scans: Scan[],
  next: NextAction,
  startTime: string,
  now: number
): number | null {
  if (next.isFinished) return null;

  if (next.eventType === "leave") {
    const arrive = scans.find(
      (s) => s.station_number === next.stationNumber && s.event_type === "arrive"
    );
    if (!arrive) return null;
    return now - new Date(arrive.scanned_at).getTime();
  }

  const sorted = [...scans].sort(
    (a, b) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime()
  );
  const last = sorted[sorted.length - 1];
  const since = last ? new Date(last.scanned_at).getTime() : new Date(startTime).getTime();
  return now - since;
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

export type Leg = {
  label: string;
  ms: number | null;
};

/**
 * Builds the full sequence of legs a team has completed so far, each
 * with its own time - a run leg (if the stations list has one in that
 * position) followed by the real station's own leg, in order. Nothing
 * here is inserted automatically beyond what the stations list actually
 * contains - a run only appears if it's genuinely on the list between
 * two real stations, using its real name.
 */
export function buildLegs(scans: Scan[], startTime: string, stations: StationDef[]): Leg[] {
  const checkpoints = realStations(stations);
  if (checkpoints.length === 0) return [];

  const maxStationNumber = stations.reduce((m, s) => Math.max(m, s.number), 0);
  const finishNumber = maxStationNumber + 1;
  const sequence = [...checkpoints, { number: finishNumber, name: "FINISH", isRun: false }];

  const sorted = [...scans].sort(
    (a, b) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime()
  );

  const legs: Leg[] = [];
  let cursor = new Date(startTime).getTime();
  let prevNumber = 0;

  for (const station of sequence) {
    const arrive = sorted.find((s) => s.station_number === station.number && s.event_type === "arrive");
    if (!arrive) {
      // Not arrived at this station yet - if a run sits in the gap
      // before it, that run is happening RIGHT NOW. Show it as the
      // final, live entry (ms: null signals "still going" the same way
      // an unfinished real station does), rather than only appearing
      // once it's actually over.
      const liveRunName = runNameInGap(stations, prevNumber, station.number);
      if (liveRunName) legs.push({ label: liveRunName, ms: null });
      break;
    }

    const arriveMs = new Date(arrive.scanned_at).getTime();
    const runName = runNameInGap(stations, prevNumber, station.number);
    if (runName) {
      legs.push({ label: runName, ms: arriveMs - cursor });
    }

    if (station.number === finishNumber) {
      legs.push({ label: "Finish", ms: null });
      break;
    }

    const leave = sorted.find((s) => s.station_number === station.number && s.event_type === "leave");
    legs.push({ label: station.name, ms: leave ? new Date(leave.scanned_at).getTime() - arriveMs : null });

    if (!leave) break; // still at this station - nothing after it yet
    cursor = new Date(leave.scanned_at).getTime();
    prevNumber = station.number;
  }

  return legs;
}

/** Per-station split table, kept for places that need arrival/departure
 * timestamps directly rather than the flattened leg list above. */
export function buildSplits(scans: Scan[], startTime: string, stations: StationDef[]) {
  const checkpoints = realStations(stations);
  if (checkpoints.length === 0) return [];

  const maxStationNumber = stations.reduce((m, s) => Math.max(m, s.number), 0);
  const finishNumber = maxStationNumber + 1;
  const sequence = [...checkpoints, { number: finishNumber, name: "FINISH", isRun: false }];

  const sorted = [...scans].sort(
    (a, b) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime()
  );
  const start = new Date(startTime).getTime();
  let cursor = start;

  return sequence.map((station) => {
    const arrive = sorted.find((s) => s.station_number === station.number && s.event_type === "arrive");
    const leave = sorted.find((s) => s.station_number === station.number && s.event_type === "leave");

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
      isFinish: station.number === finishNumber,
      runMs,
      stationMs,
      arrivedAt: arrive?.scanned_at ?? null,
      leftAt: leave?.scanned_at ?? null,
    };
  });
}
