"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildSplits, formatDuration, getNextAction, Scan } from "@/lib/timing";
import LogoutButton from "./LogoutButton";

type Team = {
  id: string;
  team_name: string;
  athlete_1: string | null;
  athlete_2: string | null;
  start_time: string;
};

type ScanRow = Scan & { id: number };

export default function TeamResults({
  team,
  initialScans,
  penalties,
}: {
  team: Team;
  initialScans: ScanRow[];
  penalties: { station_number: number; penalty_seconds: number; notes: string | null }[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [scans, setScans] = useState<ScanRow[]>(initialScans);

  useEffect(() => {
    const channel = supabase
      .channel(`scans-${team.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scans", filter: `team_id=eq.${team.id}` },
        () => {
          supabase
            .from("scans")
            .select("id, station_number, event_type, scanned_at")
            .eq("team_id", team.id)
            .order("scanned_at", { ascending: true })
            .then(({ data }) => data && setScans(data));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, team.id]);

  const splits = buildSplits(scans, team.start_time);
  const next = getNextAction(scans);
  const totalPenaltySeconds = penalties.reduce((sum, p) => sum + p.penalty_seconds, 0);

  const finishScan = scans.find((s) => s.station_number === 13);
  const rawMs = finishScan
    ? new Date(finishScan.scanned_at).getTime() - new Date(team.start_time).getTime()
    : null;
  const finalMs = rawMs != null ? rawMs + totalPenaltySeconds * 1000 : null;

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <header className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="font-display text-2xl">{team.team_name}</h1>
          <p className="text-sm text-fofGunmetal">
            {team.athlete_1}
            {team.athlete_2 ? ` & ${team.athlete_2}` : ""}
          </p>
        </div>
        <LogoutButton />
      </header>

      <section className="rounded-lg border-2 border-fofRed p-4 text-center">
        {finalMs != null ? (
          <>
            <p className="text-sm text-fofGunmetal">Final time</p>
            <p className="font-display text-3xl text-fofRed">
              {formatDuration(finalMs)}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-fofGunmetal">Currently at</p>
            <p className="font-display text-xl text-fofRed">
              {next.stationNumber <= 12
                ? `Station ${next.stationNumber}: ${next.stationName}`
                : "On the way to the finish"}
            </p>
          </>
        )}
        {totalPenaltySeconds > 0 && (
          <p className="mt-1 text-sm text-fofGunmetal">
            includes +{totalPenaltySeconds}s penalty
          </p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 font-display text-sm tracking-wide text-fofGunmetal">
          SPLITS
        </h2>
        <ul className="space-y-1 text-sm">
          {splits.map((s) => (
            <li
              key={s.station}
              className="flex justify-between border-b border-fofCharcoal py-1"
            >
              <span>{s.station === 13 ? "Finish" : `${s.station}. ${s.name}`}</span>
              <span className="text-fofGunmetal">
                {s.runMs != null && `run ${formatDuration(s.runMs)}`}
                {s.stationMs != null && ` · station ${formatDuration(s.stationMs)}`}
                {s.runMs == null && s.stationMs == null && "—"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {penalties.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-display text-sm tracking-wide text-fofGunmetal">
            PENALTIES
          </h2>
          <ul className="space-y-1 text-sm">
            {penalties.map((p, i) => (
              <li key={i} className="flex justify-between">
                <span>
                  Station {p.station_number}
                  {p.notes ? ` — ${p.notes}` : ""}
                </span>
                <span className="text-fofRed">+{p.penalty_seconds}s</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
