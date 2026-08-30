import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: judgeRow } = await supabase
    .from("judges")
    .select("id")
    .eq("id", user!.id)
    .maybeSingle();

  if (judgeRow) {
    redirect("/judge");
  }

  const { data: viewerRow } = await supabase
    .from("team_viewers")
    .select("team_id")
    .eq("id", user!.id)
    .maybeSingle();

  if (viewerRow) {
    redirect(`/team/${viewerRow.team_id}`);
  }

  // Logged in, but not attached to a judge or team-viewer role yet.
  redirect("/login?error=no-role");
}
