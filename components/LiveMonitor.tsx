"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/timing";

type LiveRow = {
  team: { id: string; team_name: string; division: string | null; wave: number | null; start_time: string };
  status: "finished" | "in_progress" | "not_started";
  currentStationNumber: number;
  currentStationLabel: string;
  currentEventType: "arrive" | "leave" | null;
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

function StatusDot({ state }: { state: "fresh" | "warn" | "stale" }) {
  const dotClass = { fresh: "bg-green-500", warn: "bg-yellow-500", stale: "bg-fofRed" };
  const title =
    state === "fresh" ? "Recent activity" : state === "warn" ? "No scan in a while" : "Possibly stalled";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotClass[state]}`} title={title} />;
}

function StationText({ row }: { row: LiveRow }) {
  if (row.currentStationNumber > 12) return <>Running to finish</>;
  return (
    <>
      <span className={row.currentEventType === "arrive" ? "text-yellow-500" : "text-green-500"}>
        {row.currentEventType === "arrive" ? "Running to" : "At"}
      </span>{" "}
      Station {row.currentStationNumber}: {row.currentStationLabel}
    </>
  );
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
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-fofGunmetal">On course</p>

              {/* Phone: stacked cards, one per team */}
              <div className="space-y-2 md:hidden">
                {inProgress.map((r) => {
                  const state = staleness(r.lastUpdate, now);
                  const totalElapsed = r.startTime ? now - new Date(r.startTime).getTime() : 0;
                  const timeOnThisLeg = r.lastUpdate ? now - new Date(r.lastUpdate).getTime() : 0;
                  return (
                    <div key={r.team.id} className="rounded border border-fofCharcoal p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2">
                          <StatusDot state={state} />
                          <span className="font-display">{r.team.team_name}</span>
                        </span>
                        <span className="text-xs text-fofGunmetal">
                          {r.judgeNames.length > 0 ? r.judgeNames.join(", ") : "no judge"}
                        </span>
                      </div>
                      <p className="mt-1 text-fofGunmetal">
                        <StationText row={r} />
                      </p>
                      <div className="mt-2 flex justify-between text-xs text-fofGunmetal">
                        <span>Here: {formatDuration(timeOnThisLeg)}</span>
                        <span>Total: {formatDuration(totalElapsed)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop/tablet: full table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-fofGunmetal text-left text-fofGunmetal">
                      <th className="p-2"></th>
                      <th className="p-2">Team #</th>
                      <th className="p-2">Judge</th>
                      <th className="p-2">Current station</th>
                      <th className="p-2">Time here</th>
                      <th className="p-2">Total time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inProgress.map((r) => {
                      const state = staleness(r.lastUpdate, now);
                      const totalElapsed = r.startTime ? now - new Date(r.startTime).getTime() : 0;
                      const timeOnThisLeg = r.lastUpdate ? now - new Date(r.lastUpdate).getTime() : 0;
                      return (
                        <tr key={r.team.id} className="border-b border-fofCharcoal">
                          <td className="p-2">
                            <StatusDot state={state} />
                          </td>
                          <td className="p-2 font-display">{r.team.team_name}</td>
                          <td className="p-2 text-fofGunmetal">
                            {r.judgeNames.length > 0 ? r.judgeNames.join(", ") : "no judge"}
                          </td>
                          <td className="p-2 text-fofGunmetal">
                            <StationText row={r} />
                          </td>
                          <td className="p-2 text-fofGunmetal">{formatDuration(timeOnThisLeg)}</td>
                          <td className="p-2 text-fofGunmetal">{formatDuration(totalElapsed)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {finished.length > 0 && (
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-fofGunmetal">Finished</p>

              {/* Phone: stacked cards */}
              <div className="space-y-2 md:hidden">
                {finished.map((r) => (
                  <div
                    key={r.team.id}
                    className="flex items-center justify-between rounded border border-fofCharcoal p-3 text-sm"
                  >
                    <div>
                      <p className="font-display">{r.team.team_name}</p>
                      <p className="text-xs text-fofGunmetal">
                        {r.judgeNames.length > 0 ? r.judgeNames.join(", ") : "no judge"}
                      </p>
                    </div>
                    <p className="font-display text-fofRed">
                      {r.finalMs != null ? formatDuration(r.finalMs) : "—"}
                    </p>
                  </div>
                ))}
              </div>

              {/* Desktop/tablet: full table */}
              <div className="hidden overflow-x-auto md:block">
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
