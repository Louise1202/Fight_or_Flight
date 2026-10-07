// SERVER-ONLY. Which event the admin, judges and the public leaderboard
// are currently working with. Stored in app_settings.active_event_id and
// changed only from /admin.
import { createAdminClient } from "@/lib/supabase/admin";
import { EVENT_COLUMNS, EventRow } from "@/lib/events";
import { fetchAll } from "@/lib/fetchAll";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function getActiveEvent(admin: AdminClient = createAdminClient()): Promise<EventRow> {
  const { data: settings } = await admin
    .from("app_settings")
    .select("active_event_id")
    .eq("id", 1)
    .maybeSingle();

  if (settings?.active_event_id) {
    const { data } = await admin
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("id", settings.active_event_id)
      .maybeSingle();
    if (data) return data as EventRow;
  }

  // No active event set (shouldn't happen after sql/019) - newest event.
  const { data: newest, error } = await admin
    .from("events")
    .select(EVENT_COLUMNS)
    .order("event_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !newest) throw new Error("No event found - run sql/019_multi_event.sql first.");
  return newest as EventRow;
}

export async function getEventById(id: string, admin: AdminClient = createAdminClient()): Promise<EventRow | null> {
  const { data } = await admin.from("events").select(EVENT_COLUMNS).eq("id", id).maybeSingle();
  return (data as EventRow | null) ?? null;
}

export type EventScan = {
  id: number;
  team_id: string;
  station_number: number;
  event_type: "arrive" | "leave";
  scanned_at: string;
  judge_id: string | null;
};

/** Every scan of one event, all pages, oldest first. */
export async function fetchEventScans(eventId: string, admin: AdminClient = createAdminClient()): Promise<EventScan[]> {
  const rows = await fetchAll<any>((from, to) =>
    admin
      .from("scans")
      .select("id, team_id, station_number, event_type, scanned_at, judge_id, teams!inner(event_id)")
      .eq("teams.event_id", eventId)
      .order("scanned_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  return rows.map(({ teams: _t, ...s }) => s as EventScan);
}

export type EventPenalty = {
  id: number;
  team_id: string;
  station_number: number | null;
  penalty_seconds: number;
  judge_id: string | null;
  notes: string | null;
  created_at: string;
};

/** Every penalty of one event. */
export async function fetchEventPenalties(eventId: string, admin: AdminClient = createAdminClient()): Promise<EventPenalty[]> {
  const rows = await fetchAll<any>((from, to) =>
    admin
      .from("penalties")
      .select("id, team_id, station_number, penalty_seconds, judge_id, notes, created_at, teams!inner(event_id)")
      .eq("teams.event_id", eventId)
      .order("id", { ascending: true })
      .range(from, to)
  );
  return rows.map(({ teams: _t, ...p }) => p as EventPenalty);
}

/** Ids of every team in an event, for filtering scans/penalties/assignments. */
export async function teamIdsForEvent(eventId: string, admin: AdminClient = createAdminClient()): Promise<string[]> {
  const { data } = await admin.from("teams").select("id").eq("event_id", eventId);
  return (data ?? []).map((t) => t.id);
}
