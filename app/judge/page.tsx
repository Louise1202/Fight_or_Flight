import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WAVE_COLUMNS, Wave } from "@/lib/waves";
import { toStationDef } from "@/lib/stations";
import { brandFor, formatEventDate, EVENT_COLUMNS, EventRow } from "@/lib/events";
import JudgeDashboard from "@/components/JudgeDashboard";
import { ScanRow } from "@/lib/useTeamScans";

export const dynamic = "force-dynamic";

export default async function JudgeHome() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: judge } = await supabase.from("judges").select("id, name, active").eq("id", user.id).maybeSingle();
  if (!judge || judge.active === false) redirect("/login?error=no-role");

  // The event everyone is working on right now (app_settings and events
  // are readable by any logged-in user).
  const { data: settings } = await supabase
    .from("app_settings")
    .select("theme, active_event_id")
    .eq("id", 1)
    .maybeSingle();
  const { data: eventRow } = await supabase
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", settings?.active_event_id ?? "")
    .maybeSingle();
  const event = eventRow as EventRow | null;
  if (!event) redirect("/login?error=no-role");

  const { data: assignments } = await supabase
    .from("judge_team_assignments")
    .select("team_id, teams!inner(id, event_id, team_name, athlete_1, athlete_2, start_time, wave, status)")
    .eq("judge_id", judge.id)
    .eq("teams.event_id", event.id);

  const teams = (assignments ?? [])
    .map((a: any) => a.teams)
    .filter((t: any) => t && t.status !== "withdrawn")
    .sort((a: any, b: any) => (a.wave ?? 999) - (b.wave ?? 999) || a.id.localeCompare(b.id));
  const teamIds = teams.map((t: any) => t.id);

  const [{ data: allScans }, { data: waves }, { data: stations }] = await Promise.all([
    teamIds.length
      ? supabase
          .from("scans")
          .select("id, team_id, station_number, event_type, scanned_at, client_scan_id")
          .in("team_id", teamIds)
          .order("scanned_at", { ascending: true })
          .range(0, 4999)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("waves").select(WAVE_COLUMNS).eq("event_id", event.id),
    supabase.from("stations").select("number, name, is_run, detail").eq("event_id", event.id).order("number"),
  ]);

  const scansByTeam: Record<string, ScanRow[]> = {};
  for (const scan of allScans ?? []) {
    (scansByTeam[scan.team_id] ??= []).push(scan);
  }
  const wavesByNumber: Record<number, Wave> = {};
  for (const w of waves ?? []) wavesByNumber[w.wave_number] = w as Wave;

  const brand = brandFor(event);

  return (
    <JudgeDashboard
      judgeName={judge.name}
      judgeId={judge.id}
      event={{
        id: event.id,
        name: event.name,
        theme: event.theme,
        heat_minutes: event.heat_minutes,
        dateLabel: formatEventDate(event.event_date),
        logo: brand.logo,
        logoRound: brand.logoRound,
      }}
      teams={teams}
      scansByTeam={scansByTeam}
      wavesByNumber={wavesByNumber}
      initialTheme={settings?.theme === "light" ? "light" : "dark"}
      stations={(stations ?? []).map(toStationDef)}
    />
  );
}
