"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getNextAction, buildSplits, buildLegs, formatDuration, getCurrentLegElapsedMs } from "@/lib/timing";
import { StationDef, withFinish, realStationIndex } from "@/lib/stations";
import { effectiveStartTime, hasWaveStarted, hasWaveEnded, Wave } from "@/lib/waves";
import { playHeatEndAlert } from "@/lib/heatAlert";
import { useSharedTheme } from "@/lib/useSharedTheme";
import { useHeat, useHeatTimeLimit } from "@/lib/useHeat";
import { useTeamScans, ScanRow } from "@/lib/useTeamScans";
import { serverNow } from "@/lib/clock";
import { friendlyDbError, EventTheme } from "@/lib/events";

type Team = {
  id: string;
  event_id: string;
  team_name: string;
  athlete_1: string | null;
  athlete_2: string | null;
  division?: string | null;
  start_time: string;
  wave: number | null;
  stopped_note?: string | null;
};

export type JudgeEventInfo = {
  id: string;
  theme: EventTheme;
  heat_minutes: number;
  locked: boolean;
};

export default function ScanScreen({
  team,
  event,
  judgeId,
  initialScans,
  initialWave,
  initialTheme,
  stations,
}: {
  team: Team;
  event: JudgeEventInfo;
  judgeId: string;
  initialScans: ScanRow[];
  initialWave: Wave | null;
  initialTheme: "dark" | "light";
  stations: StationDef[];
}) {
  const theme = useSharedTheme(initialTheme);
  const supabase = useMemo(() => createClient(), []);
  const wave = useHeat(team.event_id, team.wave, initialWave);
  const { scans, pendingCount, message, setMessage, busy, record, undo, flush } = useTeamScans({
    teamId: team.id,
    judgeId,
    stations,
    initialScans,
  });

  const clearMessage = useCallback(() => setMessage(null), [setMessage]);
  const [now, setNow] = useState(serverNow());
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [penaltySeconds, setPenaltySeconds] = useState("");
  const [penaltyNote, setPenaltyNote] = useState("");
  const [penaltyStatus, setPenaltyStatus] = useState<string | null>(null);
  const [stoppedNote, setStoppedNote] = useState(team.stopped_note ?? "");
  const [stoppedNoteStatus, setStoppedNoteStatus] = useState<string | null>(null);

  useEffect(() => {
    const tick = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(tick);
  }, []);

  const started = hasWaveStarted(wave);
  const startTime = effectiveStartTime(team.start_time, wave);
  const locallyTimedOut = useHeatTimeLimit(team.event_id, wave, event.heat_minutes, serverNow);
  const ended = hasWaveEnded(wave) || locallyTimedOut;

  const next = getNextAction(scans, stations);
  const splits = buildSplits(scans, startTime, stations);
  const legs = buildLegs(scans, startTime, stations);

  // When this team's clock stops: its own finish first (a team that
  // finished keeps its finish time even after the heat closes), then the
  // heat's end, then this phone's own time-limit detection.
  const finishedAt = next.isFinished ? splits.find((s) => s.isFinish)?.arrivedAt ?? null : null;
  const frozenAt = finishedAt
    ? new Date(finishedAt).getTime()
    : wave?.actual_end
    ? new Date(wave.actual_end).getTime()
    : locallyTimedOut
    ? new Date(startTime).getTime() + event.heat_minutes * 60 * 1000
    : null;
  const displayNow = frozenAt ?? now;
  const currentLegElapsedMs = getCurrentLegElapsedMs(scans, next, startTime, displayNow);
  const currentlyRunning = next.runName != null;

  const atLabel = next.isFinished
    ? "Finished"
    : currentlyRunning
    ? next.runName!
    : next.stationName;
  const statusPill = next.isFinished
    ? "FINISHED"
    : currentlyRunning
    ? "RUNNING"
    : next.finishesHere
    ? `AT STATION ${next.displayNumber} · LAST`
    : `AT STATION ${next.displayNumber}`;

  // "Next" names whatever genuinely happens next. Runs never get a number.
  const followingReal = !next.isFinished
    ? withFinish(stations).find((s) => !s.isRun && s.number > next.stationNumber)
    : null;
  const runBeforeFollowingReal =
    !next.isFinished && next.eventType === "leave"
      ? stations.find(
          (s) => s.isRun && s.number > next.stationNumber && (!followingReal || s.number < followingReal.number)
        )
      : null;
  const nextLabel = next.isFinished
    ? null
    : currentlyRunning
    ? `Station ${next.displayNumber} · ${next.stationName}`
    : next.finishesHere
    ? "Finish (no run after this)"
    : runBeforeFollowingReal
    ? runBeforeFollowingReal.name
    : followingReal && followingReal.name !== "FINISH"
    ? `Station ${realStationIndex(stations, followingReal.number)} · ${followingReal.name}`
    : "Finish";
  const nextDetail = currentlyRunning ? next.detail : null;

  const buttonLabel = next.finishesHere
    ? "Done · FINISH"
    : next.stationName === "FINISH"
    ? "Confirm finish"
    : next.eventType === "arrive"
    ? `Confirm arrival · Station ${next.displayNumber}`
    : `Confirm leaving · Station ${next.displayNumber}`;

  // Sound/vibration/banner on the live change from running to ended.
  const wasEndedRef = useRef(ended);
  useEffect(() => {
    if (ended && !wasEndedRef.current) playHeatEndAlert();
    wasEndedRef.current = ended;
  }, [ended]);

  useEffect(() => {
    if (!confirmUndo) return;
    const t = setTimeout(() => setConfirmUndo(false), 4000);
    return () => clearTimeout(t);
  }, [confirmUndo]);

  const savingPenalty = useRef(false);

  async function onUndo() {
    if (!confirmUndo) {
      setConfirmUndo(true);
      return;
    }
    setConfirmUndo(false);
    await undo();
  }

  async function saveStoppedNote() {
    setStoppedNoteStatus("Saving…");
    const { error } = await supabase.rpc("set_stopped_note", { p_team_id: team.id, p_note: stoppedNote });
    setStoppedNoteStatus(
      error ? friendlyDbError(error.code, "Couldn't save - check your connection and try again.") : "Saved."
    );
  }

  async function submitPenalty(e: React.FormEvent) {
    e.preventDefault();
    if (savingPenalty.current) return; // a second tap would log it twice
    const seconds = parseInt(penaltySeconds, 10);
    if (!seconds || seconds <= 0) {
      setPenaltyStatus("Enter a number of seconds greater than 0.");
      return;
    }
    savingPenalty.current = true;
    setPenaltyStatus("Saving…");
    const { error } = await supabase.from("penalties").insert({
      team_id: team.id,
      station_number: next.stationNumber,
      penalty_seconds: seconds,
      judge_id: judgeId,
      notes: penaltyNote.trim().slice(0, 200) || null,
    });
    savingPenalty.current = false;
    if (error) {
      setPenaltyStatus(friendlyDbError(error.code, "Couldn't save - check your connection and try again."));
      return;
    }
    setPenaltySeconds("");
    setPenaltyNote("");
    setPenaltyStatus("Penalty logged.");
  }

  const progress = (
    <section className="mt-8">
      <h2 className="mb-2 font-display text-sm tracking-wide text-fofGunmetal">PROGRESS</h2>
      <ul className="space-y-1 text-sm">
        {legs.map((leg, i) => {
          const isLive =
            !ended && i === legs.length - 1 && leg.ms == null && leg.kind !== "finish" && currentLegElapsedMs != null;
          return (
            <li
              key={i}
              className={`flex justify-between py-1 ${
                isLive ? "border-b-2 border-fofRed" : "border-b border-fofCharcoal"
              } ${leg.kind === "run" ? "text-fofGunmetal" : ""}`}
            >
              <span className={isLive ? "font-medium text-fofPaper" : ""}>
                {leg.kind === "station" ? `${leg.stationIndex}. ${leg.label}` : leg.label}
              </span>
              <span
                suppressHydrationWarning
                className={
                  isLive ? "nums flex items-center gap-1.5 font-medium text-fofRed" : "nums text-fofGunmetal"
                }
              >
                {isLive && <span className="inline-block h-1.5 w-1.5 rounded-full bg-fofRed" />}
                {isLive ? formatDuration(currentLegElapsedMs!) : leg.ms != null ? formatDuration(leg.ms) : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <main
      data-theme={theme}
      data-brand={event.theme}
      className="ground mx-auto min-h-screen max-w-md bg-fofBlack px-4 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-6 text-fofPaper"
    >
      <Link
        href="/judge"
        className="tap-target mb-3 inline-flex items-center gap-1 rounded-md border border-fofGunmetal px-3 py-1.5 text-sm text-fofPaper hover:border-fofRed hover:text-fofRed"
      >
        &larr; All teams
      </Link>

      <h1 className="mt-2 font-display text-2xl">{team.team_name}</h1>
      <p className="text-sm text-fofGunmetal">
        {team.athlete_1}
        {team.athlete_2 ? ` & ${team.athlete_2}` : ""}
        {team.division ? ` · ${team.division}` : ""}
        {team.wave != null ? ` · Heat ${team.wave}` : ""}
        <span className="nums"> · {team.id}</span>
      </p>

      {team.wave == null ? (
        <section className="mt-6 rounded-lg border-2 border-fofGunmetal p-6 text-center">
          <p className="font-display text-xl">No heat yet</p>
          <p className="mt-2 text-sm text-fofGunmetal">
            The organisers haven&apos;t put this team in a heat yet.
          </p>
        </section>
      ) : !started ? (
        <section className="mt-6 rounded-lg border-2 border-fofGunmetal p-6 text-center">
          <p className="text-sm text-fofGunmetal">Heat {team.wave} hasn&apos;t started yet</p>
          <p className="mt-2 font-display text-xl">Waiting for the admin to start</p>
          <p className="mt-2 text-xs text-fofGunmetal">
            Your clock and Confirm button appear the instant it starts - no need to refresh.
          </p>
        </section>
      ) : ended && !next.isFinished ? (
        <>
          <section className="mt-6 rounded-lg border-2 border-fofGunmetal p-4 text-center">
            <p className="text-sm text-fofGunmetal">Heat {team.wave} has ended</p>
            <p suppressHydrationWarning className="nums font-display text-3xl">
              {frozenAt ? formatDuration(frozenAt - new Date(startTime).getTime()) : "-"}
            </p>
            <p className="mt-2 text-xs text-fofGunmetal">
              Scanning is closed for this heat. Contact the race organiser if this team still needs to be
              recorded.
            </p>
          </section>

          <section className="mt-4 rounded-lg border border-fofCharcoal p-4">
            <h2 className="mb-2 font-display text-sm tracking-wide text-fofGunmetal">WHERE DID THEY STOP?</h2>
            <p className="mb-2 text-xs text-fofGunmetal">
              {next.eventType === "leave"
                ? `Last recorded at station ${next.displayNumber} - add a note for exactly where they were (e.g. "8 of 15 reps done").`
                : "Add a note for exactly where they were when the heat ended."}
            </p>
            <label htmlFor="stopped-note" className="sr-only">
              Where they stopped
            </label>
            <textarea
              id="stopped-note"
              value={stoppedNote}
              onChange={(e) => setStoppedNote(e.target.value)}
              placeholder="e.g. 8 of 15 reps into station 6"
              maxLength={500}
              className="tap-target w-full rounded-md border border-fofGunmetal bg-transparent px-3 py-2 text-sm"
              rows={2}
            />
            <button
              onClick={saveStoppedNote}
              className="tap-target mt-2 w-full rounded-md border border-fofGunmetal font-display text-sm"
            >
              Save note
            </button>
            {stoppedNoteStatus && (
              <p className="mt-1 text-xs text-fofGunmetal" aria-live="polite">
                {stoppedNoteStatus}
              </p>
            )}
          </section>
          {progress}
        </>
      ) : (
        <>
          <section className={`mt-6 rounded-lg border p-4 ${next.isFinished ? "border-green-600" : "border-fofCharcoal"}`}>
            <div className="flex items-baseline justify-between">
              <p className="text-sm text-fofGunmetal">{next.isFinished ? "✓ Finish time" : "Race clock"}</p>
              <p
                suppressHydrationWarning
                className={`nums font-display text-2xl ${next.isFinished ? "text-green-500" : "text-fofRed"}`}
              >
                {formatDuration(displayNow - new Date(startTime).getTime())}
              </p>
            </div>

            {!next.isFinished && (
              <>
                <div
                  className={`mt-3 rounded-lg border-2 p-3 text-center ${
                    currentlyRunning ? "border-blue-500" : "border-yellow-500"
                  }`}
                >
                  <p
                    className={`nums inline-block rounded-full border px-2 text-[11px] ${
                      currentlyRunning ? "border-blue-400 text-blue-400" : "border-yellow-500 text-yellow-500"
                    }`}
                  >
                    {statusPill}
                  </p>
                  <p className="mt-1 font-display text-lg">{atLabel}</p>
                  <p suppressHydrationWarning className="nums mt-1 font-display text-2xl text-fofRed">
                    {currentLegElapsedMs != null ? formatDuration(currentLegElapsedMs) : "-"}
                  </p>
                  {!currentlyRunning && next.detail && (
                    <p className="mt-1 text-xs text-fofGunmetal">{next.detail}</p>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                  <span className="text-fofGunmetal">Next</span>
                  <span className="text-right text-fofPaper">{nextLabel}</span>
                </div>
                {nextDetail && <p className="text-right text-xs text-fofGunmetal">{nextDetail}</p>}
              </>
            )}
          </section>

          {pendingCount > 0 && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-fofCharcoal px-3 py-2 text-sm text-fofPaper">
              <span>
                {pendingCount} scan{pendingCount > 1 ? "s" : ""} waiting to send
              </span>
              <button onClick={() => flush()} className="rounded border border-fofPaper px-2 py-1 text-xs">
                Retry now
              </button>
            </div>
          )}

          {!next.isFinished && (
            <button
              onClick={() => record(next)}
              disabled={busy || next.stationNumber === 0}
              className={`tap-target mt-4 w-full rounded-md font-display text-lg disabled:opacity-60 ${
                next.finishesHere ? "btn-finish" : "btn-stamped"
              }`}
            >
              {buttonLabel}
            </button>
          )}

          {message && (
            <p
              aria-live="polite"
              className={`mt-3 text-sm ${
                message.startsWith("✓") || message.startsWith("Saved on this phone") || message === "Last scan undone."
                  ? "text-green-500"
                  : "text-fofRed"
              }`}
            >
              {message}
            </p>
          )}

          {scans.length > 0 && (
            <div className="mt-4 flex justify-between text-sm">
              <button
                onClick={onUndo}
                className={confirmUndo ? "font-medium text-fofRed underline" : "text-fofGunmetal underline"}
              >
                {confirmUndo ? "Tap again to undo the last scan" : "Undo last scan"}
              </button>
            </div>
          )}

          {!next.isFinished && (
            <details className="mt-8 rounded-lg border border-fofCharcoal">
              <summary className="cursor-pointer p-3 font-display text-sm tracking-wide text-fofGunmetal">
                LOG A PENALTY
              </summary>
              <form onSubmit={submitPenalty} className="space-y-2 p-3 pt-0">
                <div className="flex gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    placeholder="Seconds"
                    aria-label="Penalty seconds"
                    value={penaltySeconds}
                    onChange={(e) => setPenaltySeconds(e.target.value)}
                    className="tap-target w-28 rounded-md border border-fofGunmetal bg-transparent px-3"
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
                <button type="submit" className="tap-target w-full rounded-md border border-fofGunmetal font-display">
                  Log penalty at station {next.displayNumber}
                </button>
                {penaltyStatus && <p className="text-sm text-fofGunmetal">{penaltyStatus}</p>}
              </form>
            </details>
          )}

          {progress}
        </>
      )}

      {/* Clears the message after a while so old notices don't linger. */}
      <MessageTimeout message={message} clear={clearMessage} />
    </main>
  );
}

function MessageTimeout({ message, clear }: { message: string | null; clear: () => void }) {
  useEffect(() => {
    if (!message || !message.startsWith("✓")) return;
    const t = setTimeout(clear, 6000);
    return () => clearTimeout(t);
  }, [message, clear]);
  return null;
}
