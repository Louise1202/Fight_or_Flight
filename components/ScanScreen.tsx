"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getNextAction, buildSplits, formatDuration, Scan } from "@/lib/timing";
import QrScanner from "./QrScanner";

type Team = {
  id: string;
  team_name: string;
  athlete_1: string | null;
  athlete_2: string | null;
  start_time: string;
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

// Every browser Claude targets here supports crypto.randomUUID (all modern
// mobile browsers). This is what makes a scan safely retryable: if the
// same client_scan_id is ever submitted twice, the database's unique
// constraint rejects the second one instead of recording it again.
function newScanId(): string {
  return crypto.randomUUID();
}

export default function ScanScreen({
  team,
  judgeId,
  initialScans,
}: {
  team: Team;
  judgeId: string;
  initialScans: ScanRow[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [scans, setScans] = useState<ScanRow[]>(initialScans);
  const [cameraOn, setCameraOn] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [penaltySeconds, setPenaltySeconds] = useState("");
  const [penaltyNote, setPenaltyNote] = useState("");
  const [penaltyStatus, setPenaltyStatus] = useState<string | null>(null);

  const next = getNextAction(scans);
  const splits = buildSplits(scans, team.start_time);

  const refreshFromServer = useCallback(async () => {
    const { data } = await supabase
      .from("scans")
      .select("id, station_number, event_type, scanned_at")
      .eq("team_id", team.id)
      .order("scanned_at", { ascending: true });
    if (data) setScans(data);
  }, [supabase, team.id]);

  const refreshPendingCount = useCallback(() => {
    const raw = localStorage.getItem(queueKey(team.id));
    const list: PendingScan[] = raw ? JSON.parse(raw) : [];
    setPendingCount(list.length);
  }, [team.id]);

  const flushQueue = useCallback(async () => {
    const raw = localStorage.getItem(queueKey(team.id));
    const list: PendingScan[] = raw ? JSON.parse(raw) : [];
    if (list.length === 0) return;

    const remaining: PendingScan[] = [];
    for (const item of list) {
      const { error } = await supabase.from("scans").insert(item);
      // A 23505 (unique violation) here means this exact scan already
      // made it to the server on an earlier attempt - that's a success,
      // not a failure, so we drop it from the queue rather than retrying
      // forever.
      if (error && error.code !== "23505") {
        remaining.push(item);
      }
    }
    localStorage.setItem(queueKey(team.id), JSON.stringify(remaining));
    refreshPendingCount();

    if (remaining.length < list.length) {
      await refreshFromServer();
    }
  }, [supabase, team.id, refreshPendingCount, refreshFromServer]);

  useEffect(() => {
    refreshPendingCount();
    window.addEventListener("online", flushQueue);
    const interval = setInterval(flushQueue, 15000);
    return () => {
      window.removeEventListener("online", flushQueue);
      clearInterval(interval);
    };
  }, [flushQueue, refreshPendingCount]);

  async function recordScan(stationNumber: number, eventType: "arrive" | "leave") {
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
        // The database itself rejected this as out-of-sequence - this
        // should be rare (the UI only ever offers the correct next
        // action), but if it happens, don't queue it: retrying the same
        // wrong scan will never succeed. Refresh from the server so the
        // screen shows the true current state.
        setMessage(
          "That scan doesn't match this team's expected next step. Refreshing..."
        );
        await refreshFromServer();
        return;
      }

      // Anything else (no network, DNS failure, etc.) - queue it locally
      // and keep going. The judge shouldn't be blocked by a bad signal.
      const raw = localStorage.getItem(queueKey(team.id));
      const list: PendingScan[] = raw ? JSON.parse(raw) : [];
      list.push(payload);
      localStorage.setItem(queueKey(team.id), JSON.stringify(list));
      refreshPendingCount();
      setScans((prev) => [
        ...prev,
        { id: -Date.now(), ...payload, scanned_at: payload.queued_at },
      ]);
      setMessage("Saved offline - will sync once you're back online.");
      return;
    }

    setScans((prev) => [...prev, data]);
    setMessage(null);
  }

  function handleDecode(text: string) {
    if (text !== team.id) {
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
      // it was only ever local/queued - just drop it
      const raw = localStorage.getItem(queueKey(team.id));
      const list: PendingScan[] = raw ? JSON.parse(raw) : [];
      list.pop();
      localStorage.setItem(queueKey(team.id), JSON.stringify(list));
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

      {pendingCount > 0 && (
        <p className="mt-2 rounded-md bg-fofCharcoal px-3 py-2 text-sm text-fofPaper">
          {pendingCount} scan{pendingCount > 1 ? "s" : ""} waiting to sync
        </p>
      )}

      <section className="mt-6 rounded-lg border-2 border-fofRed p-4 text-center">
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
              className="tap-target w-full rounded-md bg-fofRed font-display text-lg"
            >
              Scan QR code
            </button>
          ) : (
            <>
              <QrScanner active={cameraOn} onDecode={handleDecode} />
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
                className="tap-target flex-1 rounded-md border border-fofGunmetal bg-transparent px-3 uppercase"
              />
              <button
                onClick={handleManualConfirm}
                className="tap-target rounded-md border border-fofRed px-4 text-fofRed"
              >
                Confirm
              </button>
            </div>
          </details>
        </div>
      )}

      {message && <p className="mt-3 text-sm text-fofRed">{message}</p>}

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
              <li key={s.station} className="flex justify-between border-b border-fofCharcoal py-1">
                <span>
                  {s.station === 13 ? "Finish" : `${s.station}. ${s.name}`}
                </span>
                <span className="text-fofGunmetal">
                  {s.runMs != null && `run ${formatDuration(s.runMs)}`}
                  {s.stationMs != null && ` · station ${formatDuration(s.stationMs)}`}
                </span>
              </li>
            ))}
        </ul>
      </section>
    </main>
  );
}
