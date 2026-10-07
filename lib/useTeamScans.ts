"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { NextAction, Scan, sortScans } from "@/lib/timing";
import { StationDef, finishNumber } from "@/lib/stations";
import { friendlyDbError } from "@/lib/events";
import { serverNow, syncClock } from "@/lib/clock";

// Everything a judge's phone does with one team's scans, shared by the
// team card on the judge's list and the full scan screen:
//
// - Confirm is optimistic: the next step shows the instant it's tapped.
// - Every scan goes through a queue on the phone, sent strictly in order,
//   one at a time. Offline? It waits in the queue with its real tap time
//   and is sent when the signal is back (every 15 s, and on "online").
// - Sending stops at the first temporary failure, so a later scan can
//   never overtake an earlier one (the database would reject it and the
//   old code then threw it away).
// - Duplicate-safe: each scan carries a client_scan_id; a resend of one
//   that already arrived is recognised and simply removed from the queue.
// - Last station with no run after it: ONE tap records "leave" and
//   "finish" together (1 ms apart), and Undo removes both.
// - Two judges on one team see each other's scans (Realtime + refresh).

export type ScanRow = Scan & { id: number; client_scan_id?: string | null };

type PendingScan = {
  client_scan_id: string;
  team_id: string;
  station_number: number;
  event_type: "arrive" | "leave";
  judge_id: string;
  queued_at: string; // the real tap time, sent as scanned_at
  /** Scans created by the same tap share a group (leave + finish). */
  group: string;
  /** How many scans that tap created (2 for a one-tap finish). */
  groupSize?: number;
};

const SELECT = "id, station_number, event_type, scanned_at, client_scan_id";

function queueKey(teamId: string) {
  return `pending_scans_${teamId}`;
}

function readQueue(teamId: string): PendingScan[] {
  try {
    const raw = localStorage.getItem(queueKey(teamId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Older entries (before groups existed) get their own group.
    return parsed.map((p: PendingScan) => ({ ...p, group: p.group ?? p.client_scan_id }));
  } catch {
    try {
      localStorage.removeItem(queueKey(teamId));
    } catch {}
    return [];
  }
}

function writeQueue(teamId: string, list: PendingScan[]) {
  try {
    if (list.length === 0) localStorage.removeItem(queueKey(teamId));
    else localStorage.setItem(queueKey(teamId), JSON.stringify(list));
  } catch {
    // Storage full/unavailable - nothing more to do locally.
  }
}

export function newScanId(): string {
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
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) =>
    c === "y" ? (Math.floor(Math.random() * 4) + 8).toString(16) : Math.floor(Math.random() * 16).toString(16)
  );
}

function toInsert(p: PendingScan) {
  return {
    client_scan_id: p.client_scan_id,
    team_id: p.team_id,
    station_number: p.station_number,
    event_type: p.event_type,
    judge_id: p.judge_id,
    scanned_at: p.queued_at,
  };
}

/** Errors that will never succeed on retry - the scan is dropped and the judge told. */
function isPermanent(code: string | undefined): boolean {
  return (
    code === "P0001" || // INVALID_SCAN: not the expected next step
    code === "RT001" || // event locked
    code === "RT004" || // heat ended
    code === "23503" || // team no longer exists
    code === "42501" // not this judge's team any more
  );
}

let optimisticCounter = 0;
function optimisticId() {
  optimisticCounter += 1;
  return -(Date.now() * 10 + (optimisticCounter % 10));
}

function queuedAsRows(queue: PendingScan[]): ScanRow[] {
  return queue.map((q) => ({
    id: optimisticId(),
    client_scan_id: q.client_scan_id,
    station_number: q.station_number,
    event_type: q.event_type,
    scanned_at: q.queued_at,
  }));
}

function merge(server: ScanRow[], queue: PendingScan[]): ScanRow[] {
  const onServer = new Set(server.map((s) => s.client_scan_id).filter(Boolean));
  return sortScans([...server, ...queuedAsRows(queue.filter((q) => !onServer.has(q.client_scan_id)))]);
}

export function useTeamScans({
  teamId,
  judgeId,
  stations,
  initialScans,
}: {
  teamId: string;
  judgeId: string;
  stations: StationDef[];
  initialScans: ScanRow[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [scans, setScans] = useState<ScanRow[]>(() => sortScans(initialScans));
  const [pendingCount, setPendingCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const flushing = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("scans")
      .select(SELECT)
      .eq("team_id", teamId)
      .order("scanned_at", { ascending: true });
    if (!data) return;
    const queue = readQueue(teamId);
    setScans(merge(data as ScanRow[], queue));
    setPendingCount(queue.length);
  }, [supabase, teamId]);

  const doFlush = useCallback(async () => {
    let dropped = 0;
    let lastDropCode: string | undefined;
    let sent = 0;
    // The queue is re-read from storage on every pass, and only the item
    // just handled is removed - so a scan tapped while an earlier one is
    // still on its way is never overwritten, and is sent in this same run.
    for (let guard = 0; guard < 200; guard++) {
      const queue = readQueue(teamId);
      if (queue.length === 0) break;
      const item = queue[0];
      // A request that hangs on bad signal must not block the queue (or
      // Undo, which waits for it) - give up after 10 s and retry later.
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 10000);
      let error: { code?: string } | null = null;
      try {
        ({ error } = await supabase.from("scans").insert(toInsert(item)).abortSignal(abort.signal));
      } catch {
        error = { code: "NETWORK" };
      } finally {
        clearTimeout(timer);
      }
      if (error && error.code !== "23505") {
        if (!isPermanent(error.code)) break; // temporary - keep this and everything after it
        dropped += 1;
        lastDropCode = error.code;
      } else {
        sent += 1;
      }
      writeQueue(
        teamId,
        readQueue(teamId).filter((q) => q.client_scan_id !== item.client_scan_id)
      );
    }
    const queue = readQueue(teamId);
    setPendingCount(queue.length);
    if (dropped > 0) {
      setMessage(
        lastDropCode === "P0001"
          ? `${dropped} scan${dropped > 1 ? "s" : ""} didn't match this team's next step and ${dropped > 1 ? "were" : "was"} not saved. Check the progress list below.`
          : friendlyDbError(lastDropCode, "A scan couldn't be saved. Tell the race organiser.")
      );
    } else if (sent > 0 && queue.length === 0) {
      setMessage((m) => (m && m.startsWith("Saved on this phone") ? "✓ Sent." : m));
    }
    if (sent > 0 || dropped > 0) await refresh();
  }, [supabase, teamId, refresh]);

  /** Sends whatever is queued, one flush at a time. */
  const flush = useCallback(() => {
    if (!flushing.current) {
      flushing.current = doFlush().finally(() => {
        flushing.current = null;
      });
    }
    return flushing.current;
  }, [doFlush]);

  // On open: show anything still queued from before, start the retry loop.
  useEffect(() => {
    syncClock();
    const queue = readQueue(teamId);
    setPendingCount(queue.length);
    if (queue.length > 0) setScans((prev) => merge(prev.filter((s) => s.id > 0), queue));
    flush();
    const onOnline = () => {
      syncClock();
      flush();
    };
    window.addEventListener("online", onOnline);
    const interval = setInterval(flush, 15000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
  }, [teamId, flush]);

  // Another judge scanning the same team, or an admin correction.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`scans-${teamId}-${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "scans", filter: `team_id=eq.${teamId}` }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!flushing.current) refresh();
        }, 400);
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [supabase, teamId, refresh]);

  /** Records the next step. Returns at once; sending happens behind it. */
  const record = useCallback(
    (next: NextAction) => {
      if (next.isFinished || next.stationNumber === 0) return;
      setBusy(true);
      // A short lock against accidental double taps - not tied to the network.
      setTimeout(() => setBusy(false), 700);

      const tappedAt = serverNow();
      const group = newScanId();
      const items: PendingScan[] = [
        {
          client_scan_id: newScanId(),
          team_id: teamId,
          station_number: next.stationNumber,
          event_type: next.eventType,
          judge_id: judgeId,
          queued_at: new Date(tappedAt).toISOString(),
          group,
        },
      ];
      if (next.finishesHere) {
        items.push({
          client_scan_id: newScanId(),
          team_id: teamId,
          station_number: finishNumber(stations),
          event_type: "arrive",
          judge_id: judgeId,
          queued_at: new Date(tappedAt + 1).toISOString(),
          group,
        });
      }
      items.forEach((it) => (it.groupSize = items.length));

      const queue = [...readQueue(teamId), ...items];
      writeQueue(teamId, queue);
      setPendingCount(queue.length);
      setScans((prev) => sortScans([...prev, ...queuedAsRows(items)]));
      setMessage(
        next.finishesHere
          ? "✓ Finish recorded."
          : `✓ ${next.eventType === "arrive" ? "Arrival" : "Departure"} recorded.`
      );

      flush().then(() => {
        if (readQueue(teamId).some((q) => q.group === group)) {
          setMessage("Saved on this phone - it will be sent as soon as there's signal.");
        }
      });
    },
    [teamId, judgeId, stations, flush]
  );

  /** Removes the latest step (both scans of a one-tap finish). */
  const undo = useCallback(async (): Promise<boolean> => {
    // Feedback at once - waiting for a send in progress can take a moment.
    setMessage("Undoing…");
    await flushing.current;
    const queue = readQueue(teamId);
    if (queue.length > 0) {
      // Not sent yet - just take it off this phone.
      const lastGroup = queue[queue.length - 1].group;
      const inQueue = queue.filter((q) => q.group === lastGroup).length;
      const groupSize = queue[queue.length - 1].groupSize ?? 1;
      const kept = queue.filter((q) => q.group !== lastGroup);
      writeQueue(teamId, kept);
      setPendingCount(kept.length);
      const removedIds = new Set(queue.filter((q) => q.group === lastGroup).map((q) => q.client_scan_id));
      if (inQueue >= groupSize) {
        // Nothing of this tap reached the server: gone from the screen now,
        // and the list is re-read from the server in the background.
        setScans((prev) => prev.filter((s) => !(s.id < 0 && s.client_scan_id && removedIds.has(s.client_scan_id))));
        setMessage("Last scan undone.");
        void refresh();
        return true;
      }
      // Part of this tap (the "leave" of a one-tap finish) already reached
      // the server - take that back too, so nothing is left half-done.
      if (inQueue < groupSize) {
        const { error } = await supabase.rpc("undo_last_scan", { p_team_id: teamId });
        if (error) {
          setMessage(friendlyDbError(error.code, "Couldn't fully undo - check your connection and try again."));
          await refresh();
          return false;
        }
      }
      await refresh();
      setScans((prev) => {
        const removed = new Set(queue.filter((q) => q.group === lastGroup).map((q) => q.client_scan_id));
        return prev.filter((s) => !(s.id < 0 && s.client_scan_id && removed.has(s.client_scan_id)));
      });
      setMessage("Last scan undone.");
      return true;
    }
    const { error } = await supabase.rpc("undo_last_scan", { p_team_id: teamId });
    if (error) {
      setMessage(friendlyDbError(error.code, "Couldn't undo - check your connection and try again."));
      return false;
    }
    await refresh();
    setMessage("Last scan undone.");
    return true;
  }, [supabase, teamId, refresh]);

  return { scans, pendingCount, message, setMessage, busy, record, undo, flush, refresh };
}
