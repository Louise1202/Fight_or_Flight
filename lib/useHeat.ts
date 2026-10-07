"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Wave, WAVE_COLUMNS } from "@/lib/waves";

// Keeps one heat (event + wave number) up to date on this phone.
//
// Realtime gives the instant update when the admin starts or ends the
// heat; a poll is the safety net in case Realtime is unavailable. Every
// component watching the same heat shares ONE subscription and ONE poll
// (a judge with five teams in Heat 2 makes one request every few seconds,
// not five).

type Listener = (w: Wave) => void;
type Entry = {
  wave: Wave | null;
  listeners: Set<Listener>;
  stop: () => void;
};

const store = new Map<string, Entry>();

function keyOf(eventId: string, waveNumber: number) {
  return `${eventId}:${waveNumber}`;
}

function startWatching(eventId: string, waveNumber: number, entry: Entry) {
  const supabase = createClient();
  const publish = (w: Wave) => {
    entry.wave = w;
    entry.listeners.forEach((l) => l(w));
  };

  const fetchNow = async () => {
    const { data } = await supabase
      .from("waves")
      .select(WAVE_COLUMNS)
      .eq("event_id", eventId)
      .eq("wave_number", waveNumber)
      .maybeSingle();
    if (data) publish(data as Wave);
  };

  // Realtime filters allow one column, so filter by event and pick the
  // wave here.
  const channel = supabase
    .channel(`heat-${eventId}-${waveNumber}-${Math.random().toString(36).slice(2, 8)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "waves", filter: `event_id=eq.${eventId}` },
      (payload) => {
        const w = payload.new as Wave;
        if (w && w.wave_number === waveNumber) publish(w);
      }
    )
    .subscribe();

  // Every 4 s while the heat is waiting or running; every 20 s once it
  // has ended (so an admin "undo end" still reaches the phone).
  let timer: ReturnType<typeof setTimeout>;
  let stopped = false;
  const loop = async () => {
    await fetchNow().catch(() => {});
    // Stopped while that request was on its way - don't start another.
    if (stopped) return;
    timer = setTimeout(loop, entry.wave?.actual_end ? 20000 : 4000);
  };
  timer = setTimeout(loop, 4000);

  const onVisible = () => {
    if (document.visibilityState === "visible") fetchNow().catch(() => {});
  };
  document.addEventListener("visibilitychange", onVisible);

  entry.stop = () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    supabase.removeChannel(channel);
  };
}

export function useHeat(eventId: string | null | undefined, waveNumber: number | null | undefined, initial: Wave | null) {
  const [wave, setWave] = useState<Wave | null>(initial);

  useEffect(() => {
    if (!eventId || waveNumber == null) return;
    const key = keyOf(eventId, waveNumber);
    let entry = store.get(key);
    if (!entry) {
      entry = { wave: initial, listeners: new Set(), stop: () => {} };
      store.set(key, entry);
      startWatching(eventId, waveNumber, entry);
    } else if (entry.wave) {
      setWave(entry.wave);
    }
    const listener: Listener = (w) => setWave(w);
    entry.listeners.add(listener);
    return () => {
      const e = store.get(key);
      if (!e) return;
      e.listeners.delete(listener);
      if (e.listeners.size === 0) {
        e.stop();
        store.delete(key);
      }
    };
    // `initial` only seeds the first subscriber.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, waveNumber]);

  return wave;
}

/**
 * Whether the heat's time limit has passed by THIS phone's clock - so a
 * phone with no signal still freezes and alerts at the limit. Also asks
 * the server to close the heat (harmless if it's offline or too early:
 * the server checks the time itself).
 */
export function useHeatTimeLimit(
  eventId: string | null | undefined,
  wave: Wave | null,
  heatMinutes: number,
  nowFn: () => number
): boolean {
  const [timedOut, setTimedOut] = useState(false);
  const start = wave?.actual_start ?? null;
  const ended = !!wave?.actual_end;

  useEffect(() => {
    setTimedOut(false);
  }, [start]);

  useEffect(() => {
    if (!eventId || !wave || !start || ended) return;
    const limitAt = new Date(start).getTime() + heatMinutes * 60 * 1000;
    const check = () => {
      if (nowFn() >= limitAt) {
        setTimedOut(true);
        fetch("/api/waves/auto-close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, waveNumber: wave.wave_number }),
        }).catch(() => {});
      }
    };
    check();
    const interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, [eventId, wave, start, ended, heatMinutes, nowFn]);

  return timedOut;
}
