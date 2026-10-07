"use client";

// Judges' phones stamp every scan with their own clock, but each heat's
// start is stamped by the server. A phone that is 40 seconds fast would
// add 40 seconds to every team it times. This measures how far this
// phone is off from the server once (and again every few minutes), and
// every scan uses the corrected time.
//
// If the phone is offline, the last known offset is used (saved on the
// phone), or no correction at all - never worse than before.

const STORAGE_KEY = "clock_offset_ms";
const REFRESH_MS = 5 * 60 * 1000;

let offsetMs = readSaved();
let lastSync = 0;
let inFlight: Promise<void> | null = null;

function readSaved(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

async function measure(): Promise<void> {
  const sentAt = Date.now();
  const res = await fetch("/api/time", { cache: "no-store" });
  const receivedAt = Date.now();
  if (!res.ok) return;
  const { now } = (await res.json()) as { now: number };
  const roundTrip = receivedAt - sentAt;
  // A slow round trip makes the measurement unreliable - skip it.
  if (!Number.isFinite(now) || roundTrip > 3000) return;
  offsetMs = now - (sentAt + roundTrip / 2);
  lastSync = receivedAt;
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.round(offsetMs)));
  } catch {
    // Storage unavailable - the in-memory value still works.
  }
}

/** Measure now if it hasn't been done recently. Never throws. */
export function syncClock(): Promise<void> {
  if (Date.now() - lastSync < REFRESH_MS) return Promise.resolve();
  if (!inFlight) {
    inFlight = measure()
      .catch(() => {})
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/** The server's time, as best this phone knows it. */
export function serverNow(): number {
  return Date.now() + offsetMs;
}
