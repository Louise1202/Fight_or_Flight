// Stations used to be a hardcoded list in code. They're now real data (the
// `stations` table), editable by the admin - through the UI or the Excel
// event report - without touching code. This file is the shared shape
// everything else builds on.

export type StationDef = { number: number; name: string; isRun: boolean };

/**
 * The finish line is never stored as a row in the stations table - it's
 * always one past whatever the highest real station number is. This
 * keeps the table itself as "just the real stations" while every
 * timing calculation still gets a clean, complete sequence to work with.
 * Returns the real stations unchanged if the list is empty (nothing to
 * finish after, though this shouldn't happen in practice).
 */
export function withFinish(stations: StationDef[]): StationDef[] {
  if (stations.length === 0) return stations;
  const maxNumber = stations.reduce((m, s) => Math.max(m, s.number), 0);
  return [...stations, { number: maxNumber + 1, name: "FINISH", isRun: false }];
}

/**
 * The number a human should actually see for a given (real) station -
 * its position counting only real stations, 1, 2, 3... never counting
 * any run in between. The raw `number` column still matters internally
 * (it's what's actually stored on a scan), but nobody watching the race
 * should ever see "Station 18" when there are only 12 real stations.
 * Returns one past the last real station for the finish line or for any
 * number that isn't a real station (a run, or not found at all).
 */
export function realStationIndex(stations: StationDef[], stationNumber: number): number {
  const real = [...stations].filter((s) => !s.isRun).sort((a, b) => a.number - b.number);
  const idx = real.findIndex((s) => s.number === stationNumber);
  return idx === -1 ? real.length + 1 : idx + 1;
}
