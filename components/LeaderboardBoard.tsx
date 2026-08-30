"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/timing";
import { Standing } from "@/lib/leaderboard";

export default function LeaderboardBoard({
  initialStandings,
}: {
  initialStandings: Standing[];
}) {
  const [standings, setStandings] = useState<Standing[]>(initialStandings);
  const [now, setNow] = useState(Date.now());

  // Poll for new scan data every few seconds - a spectator screen doesn't
  // need instant push updates, and this keeps things simple and doesn't
  // require opening up read access to the raw tables.
  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/leaderboard", { cache: "no-store" });
        const data = await res.json();
        setStandings(data.standings);
      } catch {
        // transient network hiccup - just try again next tick
      }
    }, 4000);
    return () => clearInterval(poll);
  }, []);

  // Separate ticker so "elapsed time" on in-progress teams keeps counting
  // up smoothly between polls, not just jumping every 4 seconds.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const finished = standings.filter((s) => s.status === "finished");
  const inProgress = standings.filter((s) => s.status === "in_progress");
  const notStarted = standings.filter((s) => s.status === "not_started");

  return (
    <main className="min-h-screen px-6 py-8">
      <header className="mb-8 text-center">
        <img
          src="/logo.png"
          alt="Fight or Flight"
          className="mx-auto mb-3 h-20 w-20 rounded-full"
        />
        <p className="font-display text-4xl tracking-wide">
          FIGHT <span className="text-fofRed">OR</span> FLIGHT
        </p>
        <p className="text-fofGunmetal">Live leaderboard</p>
      </header>

      <div className="mx-auto max-w-4xl space-y-10">
        <section>
          <h2 className="mb-3 font-display text-2xl text-fofRed">FINISHED</h2>
          {finished.length === 0 ? (
            <p className="text-fofGunmetal">No teams have finished yet.</p>
          ) : (
            <ol className="space-y-1">
              {finished.map((s, i) => (
                <li
                  key={s.team.id}
                  className="flex items-center justify-between border-b border-fofCharcoal py-2"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-display text-xl text-fofGunmetal">{i + 1}</span>
                    <span className="font-display text-lg">{s.team.team_name}</span>
                    {s.team.division && (
                      <span className="text-sm text-fofGunmetal">{s.team.division}</span>
                    )}
                  </span>
                  <span className="font-display text-xl text-fofRed">
                    {formatDuration(s.finalMs ?? 0)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section>
          <h2 className="mb-3 font-display text-2xl">ON COURSE</h2>
          {inProgress.length === 0 ? (
            <p className="text-fofGunmetal">No teams currently on course.</p>
          ) : (
            <ul className="space-y-1">
              {inProgress.map((s) => {
                const elapsed = s.startTime ? now - new Date(s.startTime).getTime() : 0;
                return (
                  <li
                    key={s.team.id}
                    className="flex items-center justify-between border-b border-fofCharcoal py-2"
                  >
                    <span className="flex items-center gap-3">
                      <span className="font-display text-lg">{s.team.team_name}</span>
                      {s.team.division && (
                        <span className="text-sm text-fofGunmetal">{s.team.division}</span>
                      )}
                    </span>
                    <span className="text-right">
                      <span className="block text-sm text-fofGunmetal">
                        {s.currentStationNumber <= 12
                          ? `Station ${s.currentStationNumber}: ${s.currentStationLabel}`
                          : "Heading to finish"}
                      </span>
                      <span className="font-display text-lg">{formatDuration(elapsed)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {notStarted.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-2xl text-fofGunmetal">NOT STARTED</h2>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-fofGunmetal sm:grid-cols-3">
              {notStarted.map((s) => (
                <li key={s.team.id}>
                  {s.team.team_name} — wave {s.team.wave}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
