"use client";

import { useEffect, useRef, useState } from "react";
import { getNextAction } from "@/lib/timing";
import { StationDef } from "@/lib/stations";
import { hasWaveStarted, hasWaveEnded, Wave } from "@/lib/waves";
import { playHeatEndAlert } from "@/lib/heatAlert";
import { useHeat, useHeatTimeLimit, useOpenableHeat } from "@/lib/useHeat";
import { useSignal } from "@/lib/useSignal";
import { useTeamScans, ScanRow } from "@/lib/useTeamScans";
import { serverNow } from "@/lib/clock";

type Team = {
  id: string;
  event_id: string;
  team_name: string;
  athlete_1: string | null;
  athlete_2: string | null;
  start_time: string;
  wave: number | null;
};

/** For a judge with no signal, when the heat started but the phone never heard. */
export function OpenHeatButton({ waveNumber, onOpen }: { waveNumber: number; onOpen: () => void }) {
  return (
    <button
      onClick={() => {
        if (window.confirm(`Has Heat ${waveNumber} really started?\n\nOnly do this if the heat is running and this phone has no signal.`)) onOpen();
      }}
      className="tap-target mt-3 w-full rounded-md font-display btn-stamped"
    >
      The heat has started: open scanning
    </button>
  );
}

export default function TeamCard({
  team,
  judgeId,
  initialScans,
  initialWave,
  stations,
  heatMinutes,
  renderedAt,
}: {
  team: Team;
  judgeId: string;
  initialScans: ScanRow[];
  initialWave: Wave | null;
  stations: StationDef[];
  heatMinutes: number;
  renderedAt: number;
}) {
  const signal = useSignal();
  const heardWave = useHeat(team.event_id, team.wave, initialWave, renderedAt);
  const { heat: wave, open: openHeat } = useOpenableHeat(team.event_id, team.wave, heardWave);
  const { scans, pendingCount, message, busy, record, flush, logPenalty, penaltyStatus } = useTeamScans({
    teamId: team.id,
    judgeId,
    stations,
    initialScans,
    renderedAt,
  });
  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const [penaltySeconds, setPenaltySeconds] = useState("");
  const [penaltyNote, setPenaltyNote] = useState("");
  const [penaltyError, setPenaltyError] = useState<string | null>(null);

  const started = hasWaveStarted(wave);
  const locallyTimedOut = useHeatTimeLimit(team.event_id, wave, heatMinutes, serverNow);
  const ended = hasWaveEnded(wave) || locallyTimedOut;
  const next = getNextAction(scans, stations);

  const wasEndedRef = useRef(ended);
  useEffect(() => {
    if (ended && !wasEndedRef.current) playHeatEndAlert();
    wasEndedRef.current = ended;
  }, [ended]);

  function submitPenalty(e: React.FormEvent) {
    e.preventDefault();
    const seconds = parseInt(penaltySeconds, 10);
    if (!seconds || seconds <= 0) {
      setPenaltyError("Enter seconds greater than 0.");
      return;
    }
    setPenaltyError(null);
    // Clearing the box at once means a second tap can't log it twice.
    setPenaltySeconds("");
    setPenaltyNote("");
    logPenalty(next.stationNumber, seconds, penaltyNote);
  }

  const buttonLabel = next.finishesHere
    ? "Done · FINISH"
    : next.eventType === "arrive"
    ? `Arrived · Stn ${next.displayNumber}`
    : `Left · Stn ${next.displayNumber}`;

  return (
    <div className="rounded-md border border-fofGunmetal p-4">
      <a href={`/judge/${team.id}`} className="block">
        <p className="font-display text-lg">
          {team.team_name} <span className="nums text-xs text-fofGunmetal">{team.id}</span>
        </p>
        <p className="text-sm text-fofGunmetal">
          {team.athlete_1}
          {team.athlete_2 ? ` & ${team.athlete_2}` : ""}
        </p>
      </a>

      {team.wave == null ? (
        <p className="mt-2 text-sm text-fofGunmetal">No heat yet</p>
      ) : !started ? (
        <>
          <p className="mt-2 text-sm text-fofGunmetal">Waiting for Heat {team.wave} to start</p>
          {!signal && <OpenHeatButton waveNumber={team.wave} onOpen={openHeat} />}
        </>
      ) : ended && !next.isFinished ? (
        <>
          <p className="mt-1 text-sm text-fofGunmetal">Heat {team.wave} has ended - team stopped where they were</p>
          <a href={`/judge/${team.id}`} className="mt-2 inline-block text-xs text-fofRed underline">
            Add a note on where they stopped &rarr;
          </a>
        </>
      ) : (
        <>
          <p className={`mt-1 text-sm ${next.runName ? "text-blue-400" : "text-fofRed"}`}>
            {next.isFinished
              ? "✓ Finished"
              : next.runName
              ? `Running - ${next.runName}`
              : `At station ${next.displayNumber}: ${next.stationName}`}
          </p>

          {pendingCount > 0 && (
            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-fofPaper">
              <span>{pendingCount} waiting to send</span>
              <button onClick={() => flush()} className="rounded border border-fofPaper px-2 py-0.5">
                Retry now
              </button>
            </div>
          )}

          {!next.isFinished && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => record(next)}
                disabled={busy}
                className={`tap-target flex-1 rounded-md font-display disabled:opacity-60 ${
                  next.finishesHere ? "btn-finish" : "btn-stamped"
                }`}
              >
                {buttonLabel}
              </button>
              <button
                onClick={() => setPenaltyOpen((v) => !v)}
                className="tap-target rounded-md border border-fofGunmetal px-4 text-sm text-fofGunmetal"
              >
                Penalty
              </button>
            </div>
          )}

          {message && (
            <p
              aria-live="polite"
              className={`mt-2 text-sm ${
                message.startsWith("✓") || message.startsWith("Saved on this phone") ? "text-green-500" : "text-fofRed"
              }`}
            >
              {message}
            </p>
          )}

          {penaltyOpen && !next.isFinished && (
            <form onSubmit={submitPenalty} className="mt-3 flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  placeholder="Seconds"
                  aria-label="Penalty seconds"
                  value={penaltySeconds}
                  onChange={(e) => setPenaltySeconds(e.target.value)}
                  className="tap-target w-24 rounded-md border border-fofGunmetal bg-transparent px-3"
                />
                <input
                  type="text"
                  placeholder="Reason (optional)"
                  aria-label="Penalty reason"
                  maxLength={200}
                  value={penaltyNote}
                  onChange={(e) => setPenaltyNote(e.target.value)}
                  className="tap-target flex-1 rounded-md border border-fofGunmetal bg-transparent px-3"
                />
              </div>
              <button type="submit" className="tap-target rounded-md border border-fofGunmetal font-display text-sm">
                Log penalty
              </button>
              {(penaltyError ?? penaltyStatus) && <p className="text-xs text-fofGunmetal">{penaltyError ?? penaltyStatus}</p>}
            </form>
          )}
        </>
      )}
    </div>
  );
}
