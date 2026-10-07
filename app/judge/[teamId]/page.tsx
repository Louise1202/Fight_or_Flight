import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ScanScreen from "@/components/ScanScreen";
import { WAVE_COLUMNS } from "@/lib/waves";
import { toStationDef } from "@/lib/stations";
import { EventTheme } from "@/lib/events";

export const dynamic = "force-dynamic";

export default async function JudgeScanPage({ params }: { params: { teamId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: judge } = await supabase.from("judges").select("id, name, active").eq("id", user.id).maybeSingle();
  if (!judge || judge.active === false) redirect("/login?error=no-role");

  // RLS already restricts this to teams the judge is assigned to -
  // a null result means either the team doesn't exist or isn't theirs.
  const { data: team } = await supabase
    .from("teams")
    .select("id, event_id, team_name, athlete_1, athlete_2, division, start_time, wave, stopped_note")
    .eq("id", params.teamId)
    .maybeSingle();
  if (!team) notFound();

  const [{ data: scans }, { data: wave }, { data: settings }, { data: stations }, { data: event }] = await Promise.all([
    supabase
      .from("scans")
      .select("id, station_number, event_type, scanned_at, client_scan_id")
      .eq("team_id", team.id)
      .order("scanned_at", { ascending: true }),
    team.wave != null
      ? supabase
          .from("waves")
          .select(WAVE_COLUMNS)
          .eq("event_id", team.event_id)
          .eq("wave_number", team.wave)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("app_settings").select("theme").eq("id", 1).maybeSingle(),
    supabase.from("stations").select("number, name, is_run, detail").eq("event_id", team.event_id).order("number"),
    supabase.from("events").select("id, theme, heat_minutes, locked").eq("id", team.event_id).maybeSingle(),
  ]);

  return (
    <ScanScreen
      team={team}
      event={{
        id: team.event_id,
        theme: ((event?.theme as EventTheme) ?? "fof"),
        heat_minutes: event?.heat_minutes ?? 60,
        locked: !!event?.locked,
      }}
      judgeId={judge.id}
      initialScans={scans ?? []}
      initialWave={wave ?? null}
      initialTheme={settings?.theme === "light" ? "light" : "dark"}
      stations={(stations ?? []).map(toStationDef)}
    />
  );
}
