"use client";

import { useMemo, useState } from "react";
import { formatDuration } from "@/lib/timing";
import { divisionOf, rankStandings, whereText } from "@/lib/leaderboard";
import type { PublicStanding } from "./data";
import DivisionTabs, { ALL_TAB, divisionTabs } from "./DivisionTabs";

/** Final results of a finished event, with division tabs. Data is static (passed from the server). */
export default function ResultsBoard({ standings }: { standings: PublicStanding[] }) {
  const [tab, setTab] = useState<string>(ALL_TAB);
  const ranked = useMemo(() => rankStandings(standings), [standings]);
  const present = useMemo(() => [...new Set(ranked.map((s) => divisionOf(s)))], [ranked]);
  const tabs = divisionTabs(present);
  const counts: Record<string, number> = { [ALL_TAB]: ranked.length };
  for (const s of ranked) counts[divisionOf(s)] = (counts[divisionOf(s)] ?? 0) + 1;

  const list = tab === ALL_TAB ? ranked : ranked.filter((s) => divisionOf(s) === tab);
  const all = tab === ALL_TAB;
  const finished = list.filter((s) => s.status === "finished");
  const unfinished = list.filter((s) => s.status === "stopped" || s.status === "in_progress");
  const notStarted = list.filter((s) => s.status === "not_started");

  return (
    <>
      <DivisionTabs tabs={tabs} active={tab} onChange={setTab} counts={counts} />

      <div className="mx-auto max-w-5xl space-y-10">
        <section>
          <h2 className="mb-3 font-display text-2xl text-fofRed lg:text-3xl">FINISHERS</h2>
          {finished.length === 0 ? (
            <p className="text-fofGunmetal">No finishers in this division.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-fofGunmetal text-left text-xs uppercase tracking-wide text-fofGunmetal">
                  <th className="w-12 p-2 text-right">#</th>
                  <th className="p-2">Team</th>
                  <th className="hidden p-2 sm:table-cell">Heat</th>
                  <th className="hidden p-2 text-right md:table-cell">Time</th>
                  <th className="hidden p-2 text-right md:table-cell">Penalty</th>
                  <th className="p-2 text-right">Final</th>
                </tr>
              </thead>
              <tbody>
                {finished.map((s) => (
                  <tr key={s.team.id} className="border-b border-fofCharcoal align-top">
                    <td className="nums p-2 text-right text-lg text-fofGunmetal">{(all ? s.overallRank : s.divisionRank) ?? "-"}</td>
                    <td className="p-2">
                      <span className="block font-display text-lg lg:text-xl">{s.team.team_name}</span>
                      {s.team.athletes && <span className="block text-sm text-fofPaper opacity-80">{s.team.athletes}</span>}
                      <span className="nums block text-xs text-fofGunmetal">
                        {s.team.id}
                        {all && s.team.division ? ` · ${s.team.division}` : ""}
                        <span className="sm:hidden">{s.team.wave != null ? ` · Heat ${s.team.wave}` : ""}</span>
                        {s.penaltySeconds > 0 && <span className="md:hidden">{` · +${s.penaltySeconds}s penalty`}</span>}
                      </span>
                    </td>
                    <td className="nums hidden p-2 text-fofGunmetal sm:table-cell">{s.team.wave ?? "-"}</td>
                    <td className="nums hidden p-2 text-right text-fofGunmetal md:table-cell">
                      {s.rawMs != null ? formatDuration(s.rawMs) : "-"}
                    </td>
                    <td className="nums hidden p-2 text-right text-fofGunmetal md:table-cell">
                      {s.penaltySeconds > 0 ? `+${s.penaltySeconds}s` : "-"}
                    </td>
                    <td className="nums p-2 text-right text-lg text-fofRed lg:text-xl">
                      {s.finalMs != null ? formatDuration(s.finalMs) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {unfinished.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-2xl text-fofGunmetal lg:text-3xl">STOPPED (TIME LIMIT)</h2>
            <ul className="space-y-1">
              {unfinished.map((s) => (
                <li key={s.team.id} className="border-b border-fofCharcoal py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span>
                      <span className="font-display text-lg">{s.team.team_name}</span>
                      {s.team.athletes && <span className="ml-2 text-sm text-fofPaper opacity-80">{s.team.athletes}</span>}
                      <span className="nums ml-2 text-xs text-fofGunmetal">
                        {s.team.id}
                        {all && s.team.division ? ` · ${s.team.division}` : ""}
                        {s.team.wave != null ? ` · Heat ${s.team.wave}` : ""}
                      </span>
                    </span>
                    <span className="text-fofGunmetal">Stopped · {whereText(s)}</span>
                  </div>
                  {s.stoppedNote && <p className="mt-1 text-sm text-fofGunmetal">&ldquo;{s.stoppedNote}&rdquo;</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {notStarted.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-2xl text-fofGunmetal lg:text-3xl">DID NOT START</h2>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-fofGunmetal sm:grid-cols-2">
              {notStarted.map((s) => (
                <li key={s.team.id}>
                  {s.team.team_name}
                  {s.team.athletes ? ` (${s.team.athletes})` : ""} <span className="nums text-xs">{s.team.id}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
