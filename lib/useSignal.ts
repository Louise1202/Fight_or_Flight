"use client";

import { useEffect, useState } from "react";

// Whether this phone can reach the server. navigator.onLine stays true on
// a phone with bars but no data, so this also asks the server every 10 s.
// Two misses in a row count as no signal, so one slow reply doesn't flash
// the bar. Every screen shares one check.

const CHECK_MS = 10000;
const TIMEOUT_MS = 6000;

let hasSignal = true;
let misses = 0;
let checking = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<(ok: boolean) => void>();

function publish(ok: boolean) {
  if (ok === hasSignal) return;
  hasSignal = ok;
  listeners.forEach((l) => l(ok));
}

async function check() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    misses = 2;
    publish(false);
    return;
  }
  const abort = new AbortController();
  const stop = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("/api/time", { cache: "no-store", signal: abort.signal });
    if (!res.ok) throw new Error("no signal");
    misses = 0;
    publish(true);
  } catch {
    misses += 1;
    if (misses >= 2) publish(false);
  } finally {
    clearTimeout(stop);
  }
}

function loop() {
  if (checking) return;
  checking = true;
  clearTimeout(timer);
  void check().finally(() => {
    checking = false;
    if (listeners.size > 0) timer = setTimeout(loop, CHECK_MS);
  });
}

export function useSignal(): boolean {
  const [ok, setOk] = useState(hasSignal);

  useEffect(() => {
    setOk(hasSignal);
    listeners.add(setOk);
    if (listeners.size === 1) {
      window.addEventListener("online", loop);
      window.addEventListener("offline", loop);
      loop();
    }
    return () => {
      listeners.delete(setOk);
      if (listeners.size === 0) {
        clearTimeout(timer);
        window.removeEventListener("online", loop);
        window.removeEventListener("offline", loop);
      }
    };
  }, []);

  return ok;
}
