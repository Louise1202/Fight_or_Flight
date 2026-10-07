"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatDuration } from "@/lib/timing";
import { divisionOf, rankStandings, RankedStanding, whereText } from "@/lib/leaderboard";
import type { PublicEvent, PublicStanding } from "@/components/results/data";
import DivisionTabs, { ALL_TAB, divisionTabs } from "@/components/results/DivisionTabs";
import EventHeader from "@/components/results/EventHeader";
import BuiltBy from "@/components/BuiltBy";

type Ranked = RankedStanding<PublicStanding>;

const POLL_MS = 5000;

export default function LeaderboardBoard({
  event: initialEvent,
  initialStandings,
  initialGeneratedAt,
  initialDivision,
}: {
  event: PublicEvent;
  initialStandings: PublicStanding[];
  initialGeneratedAt: string;
  initialDivision?: string | null;
}) {
  const [event, setEvent] = useState<PublicEvent>(initialEvent);
  const [standings, setStandings] = useState<PublicStanding[]>(initialStandings);
  const [now, setNow] = useState(() => Date.now());
  const [stale, setStale] = useState(false);
  // Server clock minus this device's clock, so live clocks on a phone with
  // a wrong time still match the official race clock.
  const offsetRef = useRef(Date.parse(initialGeneratedAt) - Date.now());
  const [tab, setTab] = useState<string>(initialDivision || ALL_TAB);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch(`/api/leaderboard?eventId=${encodeURIComponent(initialEvent.id)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("bad status");
        const data = await res.json();
        if (cancelled) return;
        setEvent(data.event);
        setStandings(data.standings ?? []);
        if (data.generatedAt) offsetRef.current = Date.parse(data.generatedAt) - Date.now();
        setStale(false);
      } catch {
        if (!cancelled) setStale(true); // keep showing the last good data
      }
    };
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [initialEvent.id]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const ranked = useMemo(() => rankStandings(standings), [standings]);
  const present = useMemo(() => [...new Set(ranked.map((s) => divisionOf(s)))], [ranked]);
  const tabs = divisionTabs(present);
  const activeTab = tabs.includes(tab) ? tab : ALL_TAB;
  const counts: Record<string, number> = { [ALL_TAB]: ranked.length };
  for (const s of ranked) counts[divisionOf(s)] = (counts[divisionOf(s)] ?? 0) + 1;

  const list = activeTab === ALL_TAB ? ranked : ranked.filter((s) => divisionOf(s) === activeTab);
  const showDivision = activeTab === ALL_TAB;
  const rankOf = (s: Ranked) => (activeTab === ALL_TAB ? s.overallRank : s.divisionRank);

  const finished = list.filter((s) => s.status === "finished");
  const inProgress = list.filter((s) => s.status === "in_progress");
  const stopped = list.filter((s) => s.status === "stopped");
  const notStarted = list.filter((s) => s.status === "not_started");
  const serverNow = now + offsetRef.current;

  return (
    <main data-brand={event.theme} className="ground min-h-screen bg-fofBlack px-4 py-6 text-fofPaper lg:px-10 lg:py-10">
      <EventHeader event={event} subtitle={event.status === "finished" ? "Results" : "Live leaderboard"} />

      <DivisionTabs tabs={tabs} active={activeTab} onChange={setTab} counts={counts} />

      {stale && (
        <p className="mb-4 text-center text-sm text-fofGunmetal">Connection lost - showing the last update, retrying...</p>
      )}

      <div className="mx-auto max-w-5xl space-y-10">
        <section>
          <h2 className="mb-3 font-display text-2xl text-fofRed lg:text-4xl">FINISHED</h2>
          {finished.length === 0 ? (
            <p className="text-fofGunmetal lg:text-xl">No teams have finished yet.</p>
          ) : (
            <ol className="space-y-1">
              {finished.map((s) => (
                <li key={s.team.id} className="flex items-center justify-between gap-3 border-b border-fofCharcoal py-2 lg:py-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="nums w-10 shrink-0 text-right text-xl text-fofGunmetal lg:w-14 lg:text-3xl">
                      {rankOf(s) ?? "-"}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-display text-xl lg:text-3xl">{s.team.team_name}</span>
                      {s.team.athletes && (
                        <span className="block truncate text-sm text-fofPaper opacity-80 lg:text-xl">{s.team.athletes}</span>
                      )}
                      <span className="nums block text-xs text-fofGunmetal lg:text-base">
                        {s.team.id}
                        {showDivision && s.team.division ? ` · ${s.team.division}` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="nums block text-2xl text-fofRed lg:text-4xl">{formatDuration(s.finalMs ?? 0)}</span>
                    {s.penaltySeconds > 0 && (
                      <span className="nums block text-xs text-fofGunmetal lg:text-base">
                        {formatDuration(s.rawMs ?? 0)} + {s.penaltySeconds}s penalty
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {inProgress.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-2xl lg:text-4xl">ON COURSE</h2>
            <ul className="space-y-1">
              {inProgress.map((s) => {
                const elapsed = s.startTime ? serverNow - new Date(s.startTime).getTime() : 0;
                const where =
                  s.currentEventType === "leave"
                    ? `Station ${s.currentStationIndex}`
                    : s.currentStationLabel === "FINISH"
                      ? "Running to finish"
                      : "Running";
                return (
                  <li key={s.team.id} className="flex items-center justify-between gap-3 border-b border-fofCharcoal py-2 lg:py-3">
                    <span className="min-w-0">
                      <span className="block truncate font-display text-xl lg:text-3xl">{s.team.team_name}</span>
                      {s.team.athletes && (
                        <span className="block truncate text-sm text-fofPaper opacity-80 lg:text-xl">{s.team.athletes}</span>
                      )}
                      <span className="nums block text-xs text-fofGunmetal lg:text-base">
                        {s.team.id}
                        {showDivision && s.team.division ? ` · ${s.team.division}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        className={`block font-display text-lg lg:text-2xl ${
                          s.currentEventType === "leave" ? "text-fofPaper" : "text-fofGunmetal"
                        }`}
                      >
                        {where}
                      </span>
                      <span className="nums block text-xl lg:text-3xl" suppressHydrationWarning>
                        {formatDuration(elapsed)}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {stopped.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-2xl text-fofGunmetal lg:text-4xl">STOPPED (TIME LIMIT)</h2>
            <ul className="space-y-1">
              {stopped.map((s) => (
                <li key={s.team.id} className="border-b border-fofCharcoal py-2 lg:py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-display text-xl lg:text-3xl">{s.team.team_name}</span>
                      {s.team.athletes && (
                        <span className="block truncate text-sm text-fofPaper opacity-80 lg:text-xl">{s.team.athletes}</span>
                      )}
                      <span className="nums block text-xs text-fofGunmetal lg:text-base">
                        {s.team.id}
                        {showDivision && s.team.division ? ` · ${s.team.division}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-fofGunmetal lg:text-xl">Stopped · {whereText(s)}</span>
                  </div>
                  {s.stoppedNote && <p className="mt-1 text-sm text-fofGunmetal lg:text-lg">&ldquo;{s.stoppedNote}&rdquo;</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {notStarted.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-2xl text-fofGunmetal lg:text-4xl">NOT STARTED</h2>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-fofGunmetal sm:grid-cols-2 lg:grid-cols-3 lg:text-lg">
              {notStarted.map((s) => (
                <li key={s.team.id} className="truncate">
                  {s.team.team_name}
                  <span className="nums"> · {s.team.wave != null ? `Heat ${s.team.wave}` : "No heat yet"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {list.length === 0 && <p className="text-center text-fofGunmetal lg:text-xl">No teams in this division.</p>}

        {event.status === "finished" && (
          <p className="text-center text-sm">
            <Link href={`/results/${encodeURIComponent(event.id)}`} className="text-fofRed underline">
              Final results
            </Link>
          </p>
        )}
      </div>
      <BuiltBy className="mt-10 pb-6" />
    </main>
  );
}
