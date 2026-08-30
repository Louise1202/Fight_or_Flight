"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/timing";

type LiveRow = {
  team: { id: string; team_name: string; division: string | null; wave: number | null; start_time: string };
  status: "finished" | "in_progress" | "not_started";
  currentStationNumber: number;
  currentStationLabel: string;
  finalMs: number | null;
  lastUpdate: string | null;
  startTime: string | null;
  judgeNames: string[];
};

type Counts = { finished: number; inProgress: number; notStarted: number; total: number };

function staleness(lastUpdate: string | null, now: number): "fresh" | "warn" | "stale" {
  if (!lastUpdate) return "fresh";
  const seconds = (now - new Date(lastUpdate).getTime()) / 1000;
  if (seconds < 90) return "fresh";
  if (seconds < 240) return "warn";
  return "stale";
}

function timeAgo(lastUpdate: string | null, now: number): string {
  if (!lastUpdate) return "—";
  const seconds = Math.floor((now - new Date(lastUpdate).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.floor(seconds / 60)}m ago`;
}

export default function LiveMonitor() {
  const [rows, setRows] = useState<LiveRow[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [now, setNow] = useState(Date.now());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/admin/live", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) {
          setRows(data.standings);
          setCounts(data.counts);
          setLoaded(true);
        }
      } catch {
        // transient hiccup - next poll will retry
      }
    }
    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const inProgress = rows.filter((r) => r.status === "in_progress");
  const finished = rows.filter((r) => r.status === "finished");

  const dotClass = {
    fresh: "bg-green-500",
    warn: "bg-yellow-500",
    stale: "bg-fofRed",
  };

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg">Live race monitor</h2>
        {counts && (
          <p className="text-sm text-fofGunmetal">
            {counts.finished} finished · {counts.inProgress} racing · {counts.notStarted} not started
          </p>
        )}
      </div>

      {!loaded ? (
        <p className="text-sm text-fofGunmetal">Loading live status...</p>
      ) : (
        <div className="space-y-4">
          {inProgress.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-fofGunmetal">On course</p>
              <ul className="space-y-1">
                {inProgress.map((r) => {
                  const state = staleness(r.lastUpdate, now);
                  const elapsed = r.startTime ? now - new Date(r.startTime).getTime() : 0;
                  return (
                    <li
                      key={r.team.id}
                      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded border border-fofCharcoal px-3 py-2 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${dotClass[state]}`}
                          title={state === "fresh" ? "Recent activity" : state === "warn" ? "No scan in a while" : "Possibly stalled"}
                        />
                        <span className="font-display">{r.team.team_name}</span>
                        <span className="text-fofGunmetal">
                          {r.judgeNames.length > 0 ? r.judgeNames.join(", ") : "no judge"}
                        </span>
                      </span>
                      <span className="text-fofGunmetal">
                        {r.currentStationNumber <= 12
                          ? `Station ${r.currentStationNumber}`
                          : "Heading to finish"}{" "}
                        · {formatDuration(elapsed)} · last scan {timeAgo(r.lastUpdate, now)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {finished.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-fofGunmetal">Finished</p>
              <ul className="space-y-1">
                {finished.map((r) => (
                  <li
                    key={r.team.id}
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded border border-fofCharcoal px-3 py-2 text-sm"
                  >
                    <span className="font-display">{r.team.team_name}</span>
                    <span className="text-fofRed">
                      {r.finalMs != null ? formatDuration(r.finalMs) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {inProgress.length === 0 && finished.length === 0 && (
            <p className="text-sm text-fofGunmetal">No teams have started yet.</p>
          )}
        </div>
      )}
    </section>
  );
}
