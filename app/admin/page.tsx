import { redirect } from "next/navigation";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll, chunk } from "@/lib/fetchAll";
import { fetchEventScans, getActiveEvent } from "@/lib/activeEvent";
import { EVENT_COLUMNS, EventRow } from "@/lib/events";
import { toStationDef } from "@/lib/stations";
import { autoFixTeamIds } from "@/lib/rebuildTeamIds";
import AdminDashboard, { AdminTeam, EventCard } from "@/components/AdminDashboard";

export const dynamic = "force-dynamic";

// Everything here is for the ACTIVE event only (app_settings.active_event_id),
// except the list of events itself and the judges (shared by all events).
export default async function AdminPage() {
  if (!isAdminSession()) redirect("/admin/login");

  const admin = createAdminClient();
  const event = await getActiveEvent(admin);

  const [teams, { data: judges }, { data: waves }, { data: settings }, { data: stations }, { data: events }, scans, health] =
    await Promise.all([
      fetchAll<AdminTeam>((from, to) =>
        admin
          .from("teams")
          .select("id, team_name, athlete_1, athlete_2, division, wave, start_time, status, paid, registered_at")
          .eq("event_id", event.id)
          .order("id")
          .range(from, to)
      ),
      admin.from("judges").select("id, name, active").order("name"),
      admin
        .from("waves")
        .select("wave_number, scheduled_start, actual_start, actual_end, end_reason")
        .eq("event_id", event.id)
        .order("wave_number"),
      admin.from("app_settings").select("theme").eq("id", 1).maybeSingle(),
      admin.from("stations").select("number, name, is_run, detail").eq("event_id", event.id).order("number"),
      admin.from("events").select(EVENT_COLUMNS).order("event_date", { ascending: false }),
      // The one and only scan load for this page (all pages, this event).
      fetchEventScans(event.id, admin),
      // Read-only, and only for this event. Loads no scans for a
      // sequential or locked event.
      autoFixTeamIds(event.id, false),
    ]);

  const teamIds = teams.map((t) => t.id);
  const assignments: { judge_id: string; team_id: string }[] = [];
  const teamsWithViewer: string[] = [];
  for (const part of chunk(teamIds)) {
    const [{ data: a }, { data: v }] = await Promise.all([
      admin.from("judge_team_assignments").select("judge_id, team_id").in("team_id", part),
      admin.from("team_viewers").select("team_id").in("team_id", part),
    ]);
    assignments.push(...(a ?? []));
    teamsWithViewer.push(...(v ?? []).map((x) => x.team_id as string));
  }

  const eventCards: EventCard[] = await Promise.all(
    ((events ?? []) as EventRow[]).map(async (e) => {
      if (e.id === event.id) {
        return { ...e, teamCount: teams.filter((t) => t.status !== "withdrawn").length };
      }
      const { count } = await admin
        .from("teams")
        .select("id", { count: "exact", head: true })
        .eq("event_id", e.id)
        .neq("status", "withdrawn");
      return { ...e, teamCount: count ?? 0 };
    })
  );

  return (
    <AdminDashboard
      event={event}
      events={eventCards}
      teams={teams}
      judges={(judges ?? []).map((j) => ({ id: j.id, name: j.name ?? "", active: j.active !== false }))}
      assignments={assignments}
      scans={scans.map((s) => ({
        team_id: s.team_id,
        station_number: s.station_number,
        event_type: s.event_type,
        scanned_at: s.scanned_at,
      }))}
      teamsWithViewer={teamsWithViewer}
      waves={waves ?? []}
      initialTheme={settings?.theme === "light" ? "light" : "dark"}
      stations={(stations ?? []).map(toStationDef)}
      orphanedTeams={health.orphaned}
      duplicateTeamNames={health.duplicateNames}
    />
  );
}
