import { redirect } from "next/navigation";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { autoFixTeamIds } from "@/lib/rebuildTeamIds";
import AdminDashboard from "@/components/AdminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!isAdminSession()) redirect("/admin/login");

  const admin = createAdminClient();

  // Keeps team ids correct with zero admin action - if a heat was
  // retimed or renumbered any other way since the last load, this
  // quietly fixes it before anything below even fetches the roster.
  const { orphaned, duplicateNames } = await autoFixTeamIds(false);

  const [{ data: teams }, { data: judges }, { data: assignments }, { data: scans }, { data: viewers }, { data: waves }, { data: settings }, { data: stations }] =
    await Promise.all([
      admin.from("teams").select("*").order("id"),
      admin.from("judges").select("id, name").order("name"),
      admin.from("judge_team_assignments").select("judge_id, team_id"),
      admin
        .from("scans")
        .select("team_id, station_number, event_type, scanned_at"),
      admin.from("team_viewers").select("team_id"),
      admin.from("waves").select("wave_number, scheduled_start, actual_start, actual_end").order("wave_number"),
      admin.from("app_settings").select("theme").eq("id", 1).maybeSingle(),
      admin.from("stations").select("number, name, is_run").order("number"),
    ]);

  return (
    <AdminDashboard
      teams={teams ?? []}
      judges={judges ?? []}
      assignments={assignments ?? []}
      scans={scans ?? []}
      teamsWithViewer={(viewers ?? []).map((v) => v.team_id)}
      waves={waves ?? []}
      initialTheme={settings?.theme === "light" ? "light" : "dark"}
      stations={(stations ?? []).map((s: any) => ({ number: s.number, name: s.name, isRun: s.is_run }))}
      orphanedTeams={orphaned}
      duplicateTeamNames={duplicateNames}
    />
  );
}
