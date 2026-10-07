// SERVER-ONLY. Loads everything needed to compute one event's standings.
// Shared by /leaderboard, /results, /api/leaderboard, the admin live
// monitor and the Excel export so they can never disagree.
import { createAdminClient } from "@/lib/supabase/admin";
import { EventRow } from "@/lib/events";
import { chunk, fetchAll } from "@/lib/fetchAll";
import { EventPenalty, EventScan, fetchEventPenalties, fetchEventScans } from "@/lib/activeEvent";
import { computeStandings, Standing, TeamRow } from "@/lib/leaderboard";
import { StationDef, toStationDef } from "@/lib/stations";
import { Scan } from "@/lib/timing";
import { Wave } from "@/lib/waves";

type AdminClient = ReturnType<typeof createAdminClient>;

export type EventWave = Wave & { end_reason: string | null };

export type FullTeamRow = TeamRow & {
  athlete_1: string | null;
  athlete_2: string | null;
  stopped_note: string | null;
  status: string | null;
  paid: boolean | null;
};

export type EventData = {
  teams: FullTeamRow[];
  waves: EventWave[];
  stations: StationDef[];
  scans: EventScan[];
  penalties: EventPenalty[];
  standings: Standing[];
};

/** Everything for one event. Throws on a database error (callers turn it into a friendly message). */
export async function loadEventData(event: Pick<EventRow, "id">, admin: AdminClient = createAdminClient()): Promise<EventData> {
  const [teams, wavesRes, stationsRes, scans, penalties] = await Promise.all([
    fetchAll<FullTeamRow>((from, to) =>
      admin
        .from("teams")
        .select("id, team_name, athlete_1, athlete_2, division, wave, start_time, stopped_note, status, paid")
        .eq("event_id", event.id)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    admin
      .from("waves")
      .select("wave_number, scheduled_start, actual_start, actual_end, end_reason")
      .eq("event_id", event.id)
      .order("wave_number"),
    admin.from("stations").select("number, name, is_run, detail").eq("event_id", event.id).order("number"),
    fetchEventScans(event.id, admin),
    fetchEventPenalties(event.id, admin),
  ]);
  if (wavesRes.error) throw new Error("waves query failed");
  if (stationsRes.error) throw new Error("stations query failed");

  const waves = (wavesRes.data ?? []) as EventWave[];
  const stations = (stationsRes.data ?? []).map(toStationDef);

  const scansByTeam: Record<string, Scan[]> = {};
  for (const s of scans) (scansByTeam[s.team_id] ??= []).push(s);
  const penaltySecondsByTeam: Record<string, number> = {};
  for (const p of penalties) penaltySecondsByTeam[p.team_id] = (penaltySecondsByTeam[p.team_id] ?? 0) + p.penalty_seconds;
  const wavesByNumber: Record<number, Wave> = {};
  for (const w of waves) wavesByNumber[w.wave_number] = w;

  const standings = computeStandings(teams, scansByTeam, penaltySecondsByTeam, wavesByNumber, stations);
  return { teams, waves, stations, scans, penalties, standings };
}

/**
 * What a member of the public may see about a team: team name, the two
 * athletes' names (the organiser shows them next to the team, as at any
 * race), division and heat. Never contact details, medical answers,
 * judges or the judge's stopped note.
 */
export type PublicTeam = {
  id: string;
  team_name: string;
  athletes: string | null; // "Name Surname & Name Surname"
  division: string | null;
  wave: number | null;
};

function athletesOf(t: { athlete_1?: string | null; athlete_2?: string | null }): string | null {
  const names = [t.athlete_1, t.athlete_2].map((n) => (n ?? "").trim()).filter(Boolean);
  return names.length ? names.join(" & ") : null;
}
export type PublicStanding = Omit<Standing, "team"> & { team: PublicTeam };

export function toPublicStandings(standings: Standing[]): PublicStanding[] {
  return standings.map((s) => ({
    ...s,
    // The judge's free-text "where they stopped" note can mention a name
    // or an injury - admin and the team itself only, never public.
    stoppedNote: null,
    team: {
      id: s.team.id,
      team_name: s.team.team_name,
      athletes: athletesOf(s.team),
      division: s.team.division,
      wave: s.team.wave,
    },
  }));
}

export type PublicEvent = Pick<EventRow, "id" | "name" | "event_date" | "venue" | "theme" | "status">;

export function toPublicEvent(e: EventRow): PublicEvent {
  return { id: e.id, name: e.name, event_date: e.event_date, venue: e.venue, theme: e.theme, status: e.status };
}

/** Judge names per team id, for the given teams only (admin use). */
export async function judgeNamesForTeams(
  admin: AdminClient,
  teamIds: string[]
): Promise<{ byTeam: Map<string, string[]>; nameById: Map<string, string> }> {
  const { data: judges, error: judgesErr } = await admin.from("judges").select("id, name");
  if (judgesErr) throw new Error("judges query failed");
  const nameById = new Map((judges ?? []).map((j) => [j.id as string, (j.name as string) ?? "Unknown"]));
  const byTeam = new Map<string, string[]>();
  for (const ids of chunk(teamIds)) {
    const { data, error } = await admin.from("judge_team_assignments").select("judge_id, team_id").in("team_id", ids);
    if (error) throw new Error("assignments query failed");
    for (const a of data ?? []) {
      const list = byTeam.get(a.team_id) ?? [];
      list.push(nameById.get(a.judge_id) ?? "Unknown");
      byTeam.set(a.team_id, list);
    }
  }
  return { byTeam, nameById };
}

/** Event ids are short slugs like 'survivor-2026-11-07'. */
export function isPlausibleEventId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
}
