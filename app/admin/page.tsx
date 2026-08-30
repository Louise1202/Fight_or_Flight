import { redirect } from "next/navigation";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import AdminDashboard from "@/components/AdminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!isAdminSession()) redirect("/admin/login");

  const admin = createAdminClient();

  const [{ data: teams }, { data: judges }, { data: assignments }, { data: scans }, { data: viewers }] =
    await Promise.all([
      admin.from("teams").select("*").order("id"),
      admin.from("judges").select("id, name").order("name"),
      admin.from("judge_team_assignments").select("judge_id, team_id"),
      admin
        .from("scans")
        .select("team_id, station_number, event_type, scanned_at"),
      admin.from("team_viewers").select("team_id"),
    ]);

  return (
    <AdminDashboard
      teams={teams ?? []}
      judges={judges ?? []}
      assignments={assignments ?? []}
      scans={scans ?? []}
      teamsWithViewer={(viewers ?? []).map((v) => v.team_id)}
    />
  );
}
