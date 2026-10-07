import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TeamResults from "@/components/TeamResults";
import { WAVE_COLUMNS } from "@/lib/waves";
import { toStationDef } from "@/lib/stations";
import { brandFor, formatEventDate, EventTheme } from "@/lib/events";

export const dynamic = "force-dynamic";

export default async function TeamPage({ params }: { params: { teamId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: viewer } = await supabase.from("team_viewers").select("id, team_id").eq("id", user.id).maybeSingle();
  if (!viewer || viewer.team_id !== params.teamId) redirect("/login?error=no-role");

  const { data: team } = await supabase
    .from("teams")
    .select("id, event_id, team_name, athlete_1, athlete_2, start_time, wave, stopped_note")
    .eq("id", params.teamId)
    .maybeSingle();
  if (!team) notFound();

  const [{ data: scans }, { data: penalties }, { data: wave }, { data: stations }, { data: event }, { data: settings }] =
    await Promise.all([
      supabase
        .from("scans")
        .select("id, station_number, event_type, scanned_at")
        .eq("team_id", team.id)
        .order("scanned_at", { ascending: true }),
      supabase.from("penalties").select("station_number, penalty_seconds, notes").eq("team_id", team.id),
      team.wave != null
        ? supabase
            .from("waves")
            .select(WAVE_COLUMNS)
            .eq("event_id", team.event_id)
            .eq("wave_number", team.wave)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("stations").select("number, name, is_run, detail").eq("event_id", team.event_id).order("number"),
      supabase.from("events").select("id, name, event_date, theme, venue, registration_time").eq("id", team.event_id).maybeSingle(),
      supabase.from("app_settings").select("theme").eq("id", 1).maybeSingle(),
    ]);

  const brand = brandFor(event as { name: string; theme: EventTheme } | null);

  return (
    <TeamResults
      team={team}
      event={{
        name: event?.name ?? brand.title,
        theme: ((event?.theme as EventTheme) ?? "fof"),
        dateLabel: event?.event_date ? formatEventDate(event.event_date) : "",
        venue: event?.venue ?? null,
        registrationTime: event?.registration_time ?? null,
        logo: brand.logo,
        logoRound: brand.logoRound,
      }}
      initialTheme={settings?.theme === "light" ? "light" : "dark"}
      initialScans={scans ?? []}
      penalties={penalties ?? []}
      initialWave={wave ?? null}
      stations={(stations ?? []).map(toStationDef)}
    />
  );
}
