"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getNextAction, buildSplits, formatDuration, Scan } from "@/lib/timing";
import { effectiveStartTime, hasWaveStarted, Wave } from "@/lib/waves";
import QrScanner from "./QrScanner";

type Team = {
  id: string;
  team_name: string;
  athlete_1: string | null;
  athlete_2: string | null;
  start_time: string;
  wave: number | null;
};

type ScanRow = Scan & { id: number };

type PendingScan = {
  client_scan_id: string;
  team_id: string;
  station_number: number;
  event_type: "arrive" | "leave";
  judge_id: string;
  queued_at: string;
};

function queueKey(teamId: string) {
  return `pending_scans_${teamId}`;
}

// Reading/writing the local scan queue must never crash the screen, even
// if the stored data is ever malformed (e.g. from an interrupted save) -
// a corrupted queue entry is far less costly than a scan screen that
// won't load at all.
function readQueue(teamId: string): PendingScan[] {
  try {
    const raw = localStorage.getItem(queueKey(teamId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    localStorage.removeItem(queueKey(teamId));
    return [];
  }
}

function writeQueue(teamId: string, list: PendingScan[]) {
  try {
    localStorage.setItem(queueKey(teamId), JSON.stringify(list));
  } catch {
    // Storage full/unavailable - nothing more to do locally.
  }
}

function newScanId(): string {
  // crypto.randomUUID() only exists on fairly recent browsers (iOS 15.4+,
  // for example) - on an older phone this would throw and crash the
  // whole scan screen the instant a judge tries to record a scan. Fall
  // back progressively so this works on any device a judge might be
  // using on race day.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // Last resort (extremely old/unusual browsers only) - built without
  // crypto, but still in valid UUID format since the database column
  // requires it.
  const rand = () => Math.floor(Math.random() * 16).toString(16);
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (c) => {
    if (c === "y") return (Math.floor(Math.random() * 4) + 8).toString(16);
    return rand();
  });
}

export default function ScanScreen({
  team,
  judgeId,
  initialScans,
  initialWave,
}: {
  team: Team;
  judgeId: string;
  initialScans: ScanRow[];
  initialWave: Wave | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [scans, setScans] = useState<ScanRow[]>(initialScans);
  const [wave, setWave] = useState<Wave | null>(initialWave);
  const [now, setNow] = useState(Date.now());
  const [cameraOn, setCameraOn] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [penaltySeconds, setPenaltySeconds] = useState("");
  const [penaltyNote, setPenaltyNote] = useState("");
  const [penaltyStatus, setPenaltyStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const started = hasWaveStarted(wave);
  const startTime = effectiveStartTime(team.start_time, wave);
  const next = getNextAction(scans);
  const splits = buildSplits(scans, startTime);

  // Live-ticking clock, and live pickup of the admin starting this heat -
  // both are what make "started" and the on-screen clock actually real
  // time, not just a snapshot from when the page loaded.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

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

  const refreshFromServer = useCallback(async () => {
    const { data } = await supabase
      .from("scans")
      .select("id, station_number, event_type, scanned_at")
      .eq("team_id", team.id)
      .order("scanned_at", { ascending: true });
    if (data) setScans(data);
  }, [supabase, team.id]);

  const refreshPendingCount = useCallback(() => {
    const list = readQueue(team.id);
    setPendingCount(list.length);
  }, [team.id]);

  const flushQueue = useCallback(async () => {
    const list = readQueue(team.id);
    if (list.length === 0) return;

    const remaining: PendingScan[] = [];
    for (const item of list) {
      const { error } = await supabase.from("scans").insert(item);
      if (error && error.code !== "23505") {
        remaining.push(item);
      }
    }
    writeQueue(team.id, remaining);
    refreshPendingCount();

    if (remaining.length < list.length) {
      await refreshFromServer();
    }
  }, [supabase, team.id, refreshPendingCount, refreshFromServer]);

  useEffect(() => {
    refreshPendingCount();
    // Merge any scans still sitting in the local queue into what's shown
    // on screen. Without this, a scan that's queued-but-not-yet-synced
    // becomes invisible to "Next scan" and "Progress" the moment the
    // page reloads (its data lives in localStorage, not in the scans
    // fetched from the server) - the banner would say "waiting to sync"
    // while the rest of the screen quietly forgot it happened.
    const queued = readQueue(team.id);
    if (queued.length > 0) {
      setScans((prev) => {
        const existingIds = new Set(prev.map((s) => (s as any).client_scan_id));
        const toAdd = queued
          .filter((q) => !existingIds.has(q.client_scan_id))
          .map((q, i) => ({
            id: -Date.now() - i,
            client_scan_id: q.client_scan_id,
            station_number: q.station_number,
            event_type: q.event_type,
            scanned_at: q.queued_at,
          }));
        return [...prev, ...toAdd].sort(
          (a, b) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime()
        );
      });
    }
    window.addEventListener("online", flushQueue);
    const interval = setInterval(flushQueue, 15000);
    return () => {
      window.removeEventListener("online", flushQueue);
      clearInterval(interval);
    };
  }, [flushQueue, refreshPendingCount]);

  async function recordScan(stationNumber: number, eventType: "arrive" | "leave") {
    if (submitting) return; // a previous tap is still being recorded - ignore this one
    setSubmitting(true);
    try {
      await doRecordScan(stationNumber, eventType);
    } finally {
      setSubmitting(false);
    }
  }

  async function doRecordScan(stationNumber: number, eventType: "arrive" | "leave") {
    const payload: PendingScan = {
      client_scan_id: newScanId(),
      team_id: team.id,
      station_number: stationNumber,
      event_type: eventType,
      judge_id: judgeId,
      queued_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("scans")
      .insert(payload)
      .select("id, station_number, event_type, scanned_at")
      .single();

    if (error) {
      if (error.message?.includes("INVALID_SCAN")) {
        setMessage(
          "That scan doesn't match this team's expected next step. Refreshing..."
        );
        await refreshFromServer();
        return;
      }

      const list = readQueue(team.id);
      list.push(payload);
      writeQueue(team.id, list);
      refreshPendingCount();
      setScans((prev) => [
        ...prev,
        { id: -Date.now(), ...payload, scanned_at: payload.queued_at },
      ]);
      setMessage("Saved offline - will sync once you're back online.");
      return;
    }

    setScans((prev) => [...prev, data]);
    setMessage(`✓ ${eventType === "arrive" ? "Arrival" : "Departure"} recorded for station ${stationNumber === 13 ? "FINISH" : stationNumber}.`);
  }

  function handleDecode(text: string) {
    if (submitting) return; // already recording a previous scan - ignore

    // Normalize both sides the same way before comparing - strips any
    // invisible whitespace, zero-width characters, or casing difference
    // that could otherwise cause a false "wrong team" mismatch even when
    // the codes look identical on screen.
    const normalize = (s: string) =>
      s.replace(/[\s\u200B-\u200D\uFEFF]/g, "").toUpperCase();

    if (normalize(text) !== normalize(team.id)) {
      setMessage(`That QR is for a different team (${text}). Scan ${team.id} instead.`);
      return;
    }
    if (next.isFinished) {
      setMessage("This team has already finished.");
      return;
    }
    setCameraOn(false);
    recordScan(next.stationNumber, next.eventType);
  }

  function handleManualConfirm() {
    handleDecode(manualCode.trim().toUpperCase());
    setManualCode("");
  }

  async function undoLast() {
    const last = [...scans].sort(
      (a, b) => new Date(b.scanned_at).getTime() - new Date(a.scanned_at).getTime()
    )[0];
    if (!last) return;

    if (last.id < 0) {
      const list = readQueue(team.id);
      list.pop();
      writeQueue(team.id, list);
      refreshPendingCount();
    } else {
      await supabase.from("scans").delete().eq("id", last.id);
    }
    setScans((prev) => prev.filter((s) => s.id !== last.id));
  }

  async function submitPenalty(e: React.FormEvent) {
    e.preventDefault();
    setPenaltyStatus(null);
    const seconds = parseInt(penaltySeconds, 10);
    if (!seconds || seconds <= 0) {
      setPenaltyStatus("Enter a number of seconds greater than 0.");
      return;
    }
    const { error } = await supabase.from("penalties").insert({
      team_id: team.id,
      station_number: next.stationNumber,
      penalty_seconds: seconds,
      judge_id: judgeId,
      notes: penaltyNote || null,
    });
    if (error) {
      setPenaltyStatus("Couldn't save - check your connection and try again.");
      return;
    }
    setPenaltySeconds("");
    setPenaltyNote("");
    setPenaltyStatus("Penalty logged.");
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6">
      <Link href="/judge" className="text-sm text-fofGunmetal">
        &larr; All teams
      </Link>

      <h1 className="mt-2 font-display text-2xl">{team.team_name}</h1>
      <p className="text-sm text-fofGunmetal">
        {team.athlete_1}
        {team.athlete_2 ? ` & ${team.athlete_2}` : ""}
      </p>

      {!started ? (
        <section className="mt-6 rounded-lg border-2 border-fofGunmetal p-6 text-center">
          <p className="text-sm text-fofGunmetal">
            {wave ? `Heat ${wave.wave_number}` : "This team's heat"} hasn't started yet
          </p>
          <p className="mt-2 font-display text-xl">Waiting for the admin to start</p>
          <p className="mt-2 text-xs text-fofGunmetal">
            Your clock and scan button appear the instant it starts — no need to
            refresh.
          </p>
        </section>
      ) : (
        <>
          <section className="mt-6 rounded-lg border-2 border-fofRed p-4 text-center">
            <p className="text-sm text-fofGunmetal">Race clock</p>
            <p className="font-display text-3xl text-fofRed">
              {formatDuration(now - new Date(startTime).getTime())}
            </p>
          </section>

          {pendingCount > 0 && (
            <p className="mt-2 rounded-md bg-fofCharcoal px-3 py-2 text-sm text-fofPaper">
              {pendingCount} scan{pendingCount > 1 ? "s" : ""} waiting to sync
            </p>
          )}

          <section className="mt-4 rounded-lg border-2 border-fofRed p-4 text-center">
            <p className="text-sm text-fofGunmetal">Next scan</p>
            <p className="font-display text-xl text-fofRed">
              {next.isFinished ? "FINISHED" : next.label}
            </p>
          </section>

          {!next.isFinished && (
            <div className="mt-4 space-y-3">
              {!cameraOn ? (
                <button
                  onClick={() => {
                    setMessage(null);
                    setCameraOn(true);
                  }}
                  disabled={submitting}
                  className="tap-target w-full rounded-md bg-fofRed font-display text-lg disabled:opacity-50"
                >
                  {submitting ? "Recording..." : "Scan QR code"}
                </button>
              ) : (
                <>
                  <QrScanner
                    active={cameraOn}
                    onDecode={handleDecode}
                    onError={(msg) => {
                      setMessage(msg);
                      setCameraOn(false);
                    }}
                  />
                  <button
                    onClick={() => setCameraOn(false)}
                    className="tap-target w-full rounded-md border border-fofGunmetal text-fofGunmetal"
                  >
                    Cancel
                  </button>
                </>
              )}

              <details className="text-sm text-fofGunmetal">
                <summary>Camera not working? Enter code manually</summary>
                <div className="mt-2 flex gap-2">
                  <input
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder={team.id}
                    disabled={submitting}
                    className="tap-target flex-1 rounded-md border border-fofGunmetal bg-transparent px-3 uppercase disabled:opacity-50"
                  />
                  <button
                    onClick={handleManualConfirm}
                    disabled={submitting || !manualCode.trim()}
                    className="tap-target rounded-md border border-fofRed px-4 text-fofRed disabled:opacity-50"
                  >
                    {submitting ? "..." : "Confirm"}
                  </button>
                </div>
              </details>
            </div>
          )}

          {message && (
            <p
              className={`mt-3 text-sm ${
                message.startsWith("✓") || message.startsWith("Saved offline")
                  ? "text-green-500"
                  : "text-fofRed"
              }`}
            >
              {message}
            </p>
          )}

          <div className="mt-4 flex justify-between text-sm">
            <button onClick={undoLast} className="text-fofGunmetal underline">
              Undo last scan
            </button>
          </div>

          <section className="mt-8">
            <h2 className="mb-2 font-display text-sm tracking-wide text-fofGunmetal">
              LOG A PENALTY
            </h2>
            <form onSubmit={submitPenalty} className="space-y-2">
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="Seconds"
                  value={penaltySeconds}
                  onChange={(e) => setPenaltySeconds(e.target.value)}
                  className="tap-target w-28 rounded-md border border-fofGunmetal bg-transparent px-3"
                />
                <input
                  type="text"
                  placeholder="Reason (optional)"
                  value={penaltyNote}
                  onChange={(e) => setPenaltyNote(e.target.value)}
                  className="tap-target flex-1 rounded-md border border-fofGunmetal bg-transparent px-3"
                />
              </div>
              <button
                type="submit"
                className="tap-target w-full rounded-md border border-fofGunmetal font-display"
              >
                Log penalty at station {next.stationNumber <= 12 ? next.stationNumber : 12}
              </button>
              {penaltyStatus && <p className="text-sm text-fofGunmetal">{penaltyStatus}</p>}
            </form>
          </section>

          <section className="mt-8">
            <h2 className="mb-2 font-display text-sm tracking-wide text-fofGunmetal">
              PROGRESS
            </h2>
            <ul className="space-y-1 text-sm">
              {splits
                .filter((s) => s.arrivedAt)
                .map((s) => (
                  <li key={s.station}>
                    {s.runMs != null && (
                      <p className="py-0.5 text-center text-xs text-fofGunmetal">
                        {formatDuration(s.runMs)}
                      </p>
                    )}
                    <div className="flex justify-between border-b border-fofCharcoal py-1">
                      <span>
                        {s.station === 13 ? "Finish" : `${s.station}. ${s.name}`}
                      </span>
                      <span className="text-fofGunmetal">
                        {s.stationMs != null ? formatDuration(s.stationMs) : ""}
                      </span>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
