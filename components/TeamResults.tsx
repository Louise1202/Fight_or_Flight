"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildSplits, buildLegs, formatDuration, getNextAction, Scan } from "@/lib/timing";
import { effectiveStartTime, hasWaveStarted, Wave } from "@/lib/waves";
import LogoutButton from "./LogoutButton";

type Team = {
  id: string;
  team_name: string;
  athlete_1: string | null;
  athlete_2: string | null;
  start_time: string;
  wave: number | null;
};

type ScanRow = Scan & { id: number };

export default function TeamResults({
  team,
  initialScans,
  penalties,
  initialWave,
}: {
  team: Team;
  initialScans: ScanRow[];
  penalties: { station_number: number; penalty_seconds: number; notes: string | null }[];
  initialWave: Wave | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [scans, setScans] = useState<ScanRow[]>(initialScans);
  const [wave, setWave] = useState<Wave | null>(initialWave);
  const [now, setNow] = useState(Date.now());

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

  useEffect(() => {
    if (team.wave == null) return;
    const channel = supabase
      .channel(`wave-${team.wave}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "waves", filter: `wave_number=eq.${team.wave}` },
        (payload) => setWave(payload.new as Wave)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, team.wave]);

  // Safety net alongside Realtime above, in case Realtime isn't enabled
  // for the waves table - the team's own clock still starts within a
  // few seconds on its own either way, with no refresh needed.
  useEffect(() => {
    if (team.wave == null || hasWaveStarted(wave)) return;
    const poll = setInterval(async () => {
      const { data } = await supabase
        .from("waves")
        .select("wave_number, scheduled_start, actual_start, actual_end")
        .eq("wave_number", team.wave)
        .maybeSingle();
      if (data) setWave(data as Wave);
    }, 3000);
    return () => clearInterval(poll);
  }, [supabase, team.wave, wave]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const started = hasWaveStarted(wave);
  const startTime = effectiveStartTime(team.start_time, wave);
  const splits = buildSplits(scans, startTime);
  const legs = buildLegs(splits);
  const next = getNextAction(scans);
  const totalPenaltySeconds = penalties.reduce((sum, p) => sum + p.penalty_seconds, 0);

  const finishScan = scans.find((s) => s.station_number === 13);
  const rawMs = finishScan
    ? new Date(finishScan.scanned_at).getTime() - new Date(startTime).getTime()
    : null;
  const finalMs = rawMs != null ? rawMs + totalPenaltySeconds * 1000 : null;
  const liveElapsedMs = started ? now - new Date(startTime).getTime() : null;

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

      {!started ? (
        <section className="rounded-lg border-2 border-fofGunmetal p-6 text-center">
          <p className="text-sm text-fofGunmetal">
            {wave ? `Heat ${wave.wave_number}` : "Your heat"} hasn't started yet
          </p>
          <p className="mt-2 font-display text-xl">Get ready!</p>
        </section>
      ) : (
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
              <p className="text-sm text-fofGunmetal">Race clock</p>
              <p className="font-display text-3xl text-fofRed">
                {formatDuration(liveElapsedMs ?? 0)}
              </p>
              <p className="mt-1 text-sm text-fofGunmetal">
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
      )}

      <section className="mt-6">
        <h2 className="mb-2 font-display text-sm tracking-wide text-fofGunmetal">
          SPLITS
        </h2>
        <ul className="space-y-1 text-sm">
          {legs.map((leg, i) => (
            <li
              key={i}
              className="flex justify-between border-b border-fofCharcoal py-1"
            >
              <span>
                {i + 1}. {leg.label}
              </span>
              <span className="text-fofGunmetal">
                {leg.ms != null ? formatDuration(leg.ms) : ""}
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
