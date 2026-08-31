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
        <div className="space-y-6">
          {inProgress.length > 0 && (
            <div className="overflow-x-auto">
              <p className="mb-1 text-xs uppercase tracking-wide text-fofGunmetal">On course</p>
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-fofGunmetal text-left text-fofGunmetal">
                    <th className="p-2"></th>
                    <th className="p-2">Team #</th>
                    <th className="p-2">Judge</th>
                    <th className="p-2">Current station</th>
                    <th className="p-2">Elapsed</th>
                    <th className="p-2">Last scan</th>
                  </tr>
                </thead>
                <tbody>
                  {inProgress.map((r) => {
                    const state = staleness(r.lastUpdate, now);
                    const elapsed = r.startTime ? now - new Date(r.startTime).getTime() : 0;
                    return (
                      <tr key={r.team.id} className="border-b border-fofCharcoal">
                        <td className="p-2">
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${dotClass[state]}`}
                            title={
                              state === "fresh"
                                ? "Recent activity"
                                : state === "warn"
                                ? "No scan in a while"
                                : "Possibly stalled"
                            }
                          />
                        </td>
                        <td className="p-2 font-display">{r.team.team_name}</td>
                        <td className="p-2 text-fofGunmetal">
                          {r.judgeNames.length > 0 ? r.judgeNames.join(", ") : "no judge"}
                        </td>
                        <td className="p-2 text-fofGunmetal">
                          {r.currentStationNumber <= 12
                            ? `Station ${r.currentStationNumber}`
                            : "Heading to finish"}
                        </td>
                        <td className="p-2 text-fofGunmetal">{formatDuration(elapsed)}</td>
                        <td className="p-2 text-fofGunmetal">{timeAgo(r.lastUpdate, now)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {finished.length > 0 && (
            <div className="overflow-x-auto">
              <p className="mb-1 text-xs uppercase tracking-wide text-fofGunmetal">Finished</p>
              <table className="w-full min-w-[400px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-fofGunmetal text-left text-fofGunmetal">
                    <th className="p-2">Team #</th>
                    <th className="p-2">Judge</th>
                    <th className="p-2">Final time</th>
                  </tr>
                </thead>
                <tbody>
                  {finished.map((r) => (
                    <tr key={r.team.id} className="border-b border-fofCharcoal">
                      <td className="p-2 font-display">{r.team.team_name}</td>
                      <td className="p-2 text-fofGunmetal">
                        {r.judgeNames.length > 0 ? r.judgeNames.join(", ") : "no judge"}
                      </td>
                      <td className="p-2 text-fofRed">
                        {r.finalMs != null ? formatDuration(r.finalMs) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
