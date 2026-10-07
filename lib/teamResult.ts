// SERVER-ONLY. One team's result, worked out from exactly the same data and
// code as the leaderboard (components/results/data.ts), so the results
// email, the passwordless results page and the share picture can never
// disagree with what the big screen shows.
//
// Also the passwordless results links: /r/<token>. The token is 32 random
// bytes; only its SHA-256 hash is stored (team_result_links, sql/020).
import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEventById } from "@/lib/activeEvent";
import { EventRow } from "@/lib/events";
import { EventData, FullTeamRow, loadEventData, stationRecords } from "@/components/results/data";
import { rankStandings, RankedStanding, Standing } from "@/lib/leaderboard";
import { buildLegs, Leg, Scan } from "@/lib/timing";
import { effectiveStartTime } from "@/lib/waves";
import { finishNumber, realStationIndex } from "@/lib/stations";

type AdminClient = ReturnType<typeof createAdminClient>;

export const RESULT_LINK_DAYS = 30;

export type TeamResult = {
  event: EventRow;
  team: FullTeamRow;
  /** finished | stopped | in_progress | not_started */
  status: Standing["status"];
  standing: RankedStanding<Standing> | null;
  /** Official time (finished) or time on course when the heat ended. */
  timeMs: number | null;
  penaltySeconds: number;
  penalties: { station: string; seconds: number; notes: string | null }[];
  legs: Leg[];
  stationsDone: number;
  stationsTotal: number;
  fastest: { stationIndex: number; label: string; ms: number } | null;
  /** The day's record at the team's fastest station, if there is one. */
  record: { name: string; ms: number; teamName: string; isThisTeam: boolean } | null;
  divisionRank: number | null;
  overallRank: number | null;
  /** Teams in the team's division / in the event (withdrawn left out). */
  divisionTeams: number;
  overallTeams: number;
  /** Other heats (with teams in them) that have not ended yet. */
  heatsToGo: number;
  heatEndReason: string | null;
};

/** Pure: builds one team's result from an event's loaded data. */
export function buildTeamResult(event: EventRow, data: EventData, teamId: string): TeamResult | null {
  const team = data.teams.find((t) => t.id === teamId);
  if (!team) return null;

  const ranked = rankStandings(data.standings);
  const standing = ranked.find((s) => s.team.id === teamId) ?? null;
  const wave = team.wave != null ? data.waves.find((w) => w.wave_number === team.wave) : undefined;
  const startTime = effectiveStartTime(team.start_time, wave);

  const scans: Scan[] = data.scans
    .filter((s) => s.team_id === teamId)
    .map((s) => ({ station_number: s.station_number, event_type: s.event_type, scanned_at: s.scanned_at }));
  const legs = wave?.actual_start ? buildLegs(scans, startTime, data.stations).filter((l) => l.kind !== "finish") : [];

  const status = standing?.status ?? "not_started";
  let timeMs: number | null = null;
  if (status === "finished") timeMs = standing?.finalMs ?? null;
  else if (status === "stopped" && standing?.stoppedAt && standing.startTime)
    timeMs = new Date(standing.stoppedAt).getTime() - new Date(standing.startTime).getTime();
  else if (status === "in_progress" && standing?.startTime) timeMs = Date.now() - new Date(standing.startTime).getTime();

  const stationLegs = legs.filter((l) => l.kind === "station" && l.ms != null && l.stationIndex != null);
  const best = stationLegs.reduce<Leg | null>((b, l) => (b == null || (l.ms ?? Infinity) < (b.ms ?? Infinity) ? l : b), null);
  const fastest = best && best.ms != null && best.stationIndex != null
    ? { stationIndex: best.stationIndex, label: best.label, ms: best.ms }
    : null;

  let record: TeamResult["record"] = null;
  if (fastest) {
    const r = stationRecords(data).find((x) => x.stationIndex === fastest.stationIndex);
    if (r) record = { name: r.name, ms: r.ms, teamName: r.teamName, isThisTeam: r.teamName === team.team_name && r.ms === fastest.ms };
  }

  const finishNo = finishNumber(data.stations);
  const penalties = data.penalties
    .filter((p) => p.team_id === teamId)
    .map((p) => ({
      station: p.station_number == null ? "" : p.station_number === finishNo ? "Finish" : `Station ${realStationIndex(data.stations, p.station_number)}`,
      seconds: p.penalty_seconds,
      notes: p.notes,
    }));

  const active = data.standings; // computeStandings already leaves withdrawn teams out
  const division = team.division?.trim() || null;
  const divisionTeams = active.filter((s) => (s.team.division?.trim() || null) === division).length;

  const wavesWithTeams = new Set(active.map((s) => s.team.wave).filter((w): w is number => w != null));
  const heatsToGo = data.waves.filter(
    (w) => w.wave_number !== team.wave && wavesWithTeams.has(w.wave_number) && !w.actual_end
  ).length;

  return {
    event,
    team,
    status,
    standing,
    timeMs,
    penaltySeconds: standing?.penaltySeconds ?? 0,
    penalties,
    legs,
    stationsDone: standing?.completedStations ?? 0,
    stationsTotal: data.stations.filter((s) => !s.isRun).length,
    fastest,
    record,
    divisionRank: standing?.divisionRank ?? null,
    overallRank: standing?.overallRank ?? null,
    divisionTeams,
    overallTeams: active.length,
    heatsToGo,
    heatEndReason: wave?.end_reason ?? null,
  };
}

/** Loads the team's own event and works out its result. null if unknown. */
export async function loadTeamResult(teamId: string, admin: AdminClient = createAdminClient()): Promise<TeamResult | null> {
  const { data: t, error } = await admin.from("teams").select("event_id").eq("id", teamId).maybeSingle();
  if (error || !t) return null;
  const event = await getEventById(t.event_id as string, admin);
  if (!event) return null;
  const data = await loadEventData(event, admin);
  return buildTeamResult(event, data, teamId);
}

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// ---------------------------------------------------------------------
// Passwordless links
// ---------------------------------------------------------------------

export function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || "https://race.betterdesk.app").replace(/\/+$/, "");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isPlausibleToken(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{32,64}$/.test(v);
}

/** New random link for a team, valid for 30 days. Returns the raw token. */
export async function createResultLink(admin: AdminClient, teamId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + RESULT_LINK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await admin
    .from("team_result_links")
    .insert({ token_hash: hashToken(token), team_id: teamId, expires_at: expires });
  if (error) throw new Error("result link insert failed");
  return token;
}

/** The team id for a link token, or null if unknown or expired. */
export async function teamForToken(token: string, admin: AdminClient = createAdminClient()): Promise<string | null> {
  if (!isPlausibleToken(token)) return null;
  const { data, error } = await admin
    .from("team_result_links")
    .select("team_id, expires_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null;
  return data.team_id as string;
}
