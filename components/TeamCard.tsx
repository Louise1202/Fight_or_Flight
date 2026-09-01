"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getNextAction, Scan } from "@/lib/timing";
import { effectiveStartTime, hasWaveStarted, Wave } from "@/lib/waves";

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
    // storage full/unavailable - nothing more to do locally
  }
}

function newScanId(): string {
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
  const rand = () => Math.floor(Math.random() * 16).toString(16);
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) =>
    c === "y" ? (Math.floor(Math.random() * 4) + 8).toString(16) : rand()
  );
}

// queued_at exists only for this phone's own local ordering/display - it
// is NOT a column in the scans table, and must never be sent to the
// database. Both places that insert a scan go through this helper.
function toScanInsert(p: PendingScan) {
  const { queued_at, ...dbFields } = p;
  return dbFields;
}

export default function TeamCard({
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
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const [penaltySeconds, setPenaltySeconds] = useState("");
  const [penaltyNote, setPenaltyNote] = useState("");
  const [penaltyStatus, setPenaltyStatus] = useState<string | null>(null);

  const started = hasWaveStarted(wave);
  const startTime = effectiveStartTime(team.start_time, wave);
  const next = getNextAction(scans);

  useEffect(() => {
    if (team.wave == null) return;
    const channel = supabase
      .channel(`wave-${team.wave}-card-${team.id}`)
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

  const refreshFromServer = useCallback(async () => {
    const { data } = await supabase
      .from("scans")
      .select("id, station_number, event_type, scanned_at")
      .eq("team_id", team.id)
      .order("scanned_at", { ascending: true });
    if (data) setScans(data);
  }, [supabase, team.id]);

  const refreshPendingCount = useCallback(() => {
    setPendingCount(readQueue(team.id).length);
  }, [team.id]);

  const flushQueue = useCallback(async () => {
    const list = readQueue(team.id);
    if (list.length === 0) return;
    const remaining: PendingScan[] = [];
    for (const item of list) {
      const { error } = await supabase.from("scans").insert(toScanInsert(item));
      if (error && error.code !== "23505" && !error.code) {
        remaining.push(item);
      }
    }
    writeQueue(team.id, remaining);
    refreshPendingCount();
    if (remaining.length < list.length) await refreshFromServer();
  }, [supabase, team.id, refreshPendingCount, refreshFromServer]);

  useEffect(() => {
    refreshPendingCount();
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
  }, [flushQueue, refreshPendingCount, team.id]);

  async function confirm() {
    if (submitting || next.isFinished) return;
    setSubmitting(true);
    setMessage(null);

    const payload: PendingScan = {
      client_scan_id: newScanId(),
      team_id: team.id,
      station_number: next.stationNumber,
      event_type: next.eventType,
      judge_id: judgeId,
      queued_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("scans")
      .insert(toScanInsert(payload))
      .select("id, station_number, event_type, scanned_at")
      .single();

    if (error) {
      if (error.message?.includes("INVALID_SCAN")) {
        setMessage("Doesn't match this team's next step. Refreshing...");
        await refreshFromServer();
        setSubmitting(false);
        return;
      }
      if (error.code) {
        setMessage(`Couldn't save: ${error.message}. Tell the organizer.`);
        setSubmitting(false);
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
      setSubmitting(false);
      return;
    }

    setScans((prev) => [...prev, data]);
    setMessage(
      `✓ ${payload.event_type === "arrive" ? "Arrival" : "Departure"} recorded.`
    );
    setSubmitting(false);
  }

  async function submitPenalty(e: React.FormEvent) {
    e.preventDefault();
    setPenaltyStatus(null);
    const seconds = parseInt(penaltySeconds, 10);
    if (!seconds || seconds <= 0) {
      setPenaltyStatus("Enter seconds greater than 0.");
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
      setPenaltyStatus("Couldn't save - check your connection.");
      return;
    }
    setPenaltySeconds("");
    setPenaltyNote("");
    setPenaltyStatus("Penalty logged.");
  }

  return (
    <div className="rounded-md border border-fofGunmetal p-4">
      <Link href={`/judge/${team.id}`} className="block">
        <p className="font-display text-lg">{team.team_name}</p>
        <p className="text-sm text-fofGunmetal">
          {team.athlete_1}
          {team.athlete_2 ? ` & ${team.athlete_2}` : ""}
        </p>
      </Link>

      {!started ? (
        <p className="mt-2 text-sm text-fofGunmetal">
          Waiting for Heat {team.wave} to start
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-fofRed">
            {next.isFinished ? "Finished" : `Next: ${next.label}`}
          </p>

          {pendingCount > 0 && (
            <p className="mt-1 text-xs text-fofPaper">
              {pendingCount} waiting to sync
            </p>
          )}

          {!next.isFinished && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={confirm}
                disabled={submitting}
                className="tap-target flex-1 rounded-md btn-stamped font-display disabled:opacity-50"
              >
                {submitting ? "..." : "Confirm"}
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
              className={`mt-2 text-sm ${
                message.startsWith("✓") || message.startsWith("Saved offline")
                  ? "text-green-500"
                  : "text-fofRed"
              }`}
            >
              {message}
            </p>
          )}

          {penaltyOpen && (
            <form onSubmit={submitPenalty} className="mt-3 flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="Seconds"
                  value={penaltySeconds}
                  onChange={(e) => setPenaltySeconds(e.target.value)}
                  className="tap-target w-24 rounded-md border border-fofGunmetal bg-transparent px-3"
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
                className="tap-target rounded-md border border-fofGunmetal font-display text-sm"
              >
                Log penalty
              </button>
              {penaltyStatus && <p className="text-xs text-fofGunmetal">{penaltyStatus}</p>}
            </form>
          )}
        </>
      )}
    </div>
  );
}
