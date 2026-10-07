import { NextRequest } from "next/server";
import { fetchAll } from "@/lib/fetchAll";
import { loadEventData } from "@/components/results/data";
import { emailConfigured, EmailKind, loadEmailSettings, recipientsFor, sendTeamEmail } from "@/lib/resultsEmail";
import { adminContext, fail, json, readBody, teamInEvent } from "../_lib/guard";

// Results emails of the ACTIVE event: status per team (GET) and
// "Send again" for one team (POST { teamId, kind, resend: true }).
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Row = {
  team_id: string;
  kind: EmailKind;
  status: "sent" | "failed" | "skipped";
  recipients: number;
  error: string | null;
  sent_at: string;
};

export async function GET() {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;

  const settings = await loadEmailSettings(admin, event.id);
  if (!settings) {
    return json({ configured: emailConfigured(), migrated: false, settings: null, teams: [], waves: [] });
  }

  let rows: Row[];
  try {
    rows = await fetchAll<Row>((from, to) =>
      admin
        .from("result_emails")
        .select("id, team_id, kind, status, recipients, error, sent_at, teams!inner(event_id)")
        .eq("teams.event_id", event.id)
        .order("id", { ascending: true })
        .range(from, to)
    );
  } catch {
    return fail("Couldn't load the results-email status.", 500);
  }
  const { data: waves } = await admin
    .from("waves")
    .select("wave_number, actual_start, actual_end")
    .eq("event_id", event.id);

  const byTeam: Record<string, { heat?: Omit<Row, "team_id" | "kind">; final?: Omit<Row, "team_id" | "kind"> }> = {};
  for (const r of rows) {
    const entry = (byTeam[r.team_id] ??= {});
    // "sending" is the claim marker; error text is an HTTP status at most.
    entry[r.kind] = { status: r.status, recipients: r.recipients, error: r.error, sent_at: r.sent_at };
  }

  return json({
    configured: emailConfigured(),
    migrated: true,
    settings,
    locked: event.locked,
    teams: byTeam,
    waves: (waves ?? []).map((w) => ({ wave_number: w.wave_number, started: !!w.actual_start, ended: !!w.actual_end })),
  });
}

export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;

  if (!emailConfigured()) return fail("Email sending isn't connected yet.", 409);
  const body = await readBody(req);
  const teamId = typeof body?.teamId === "string" ? body.teamId : "";
  const kind = body?.kind === "final" ? "final" : body?.kind === "heat" ? "heat" : null;
  if (!teamId || !kind || body?.resend !== true) return fail("Choose a team and which email to send.");

  let team;
  try {
    team = await teamInEvent(admin, teamId, event.id);
  } catch {
    return fail("Couldn't load that team.", 500);
  }
  if (!team) return fail("That team isn't in the active event.", 404);
  if (team.status === "withdrawn") return fail("This team has withdrawn - no results email.", 409);

  if (kind === "final" && !event.locked) return fail("Final places are sent once the event is finished and locked.", 409);
  if (kind === "heat") {
    if (team.wave == null) return fail("This team has no heat yet.", 409);
    const { data: w } = await admin
      .from("waves")
      .select("actual_end")
      .eq("event_id", event.id)
      .eq("wave_number", team.wave)
      .maybeSingle();
    if (!w?.actual_end) return fail(`Heat ${team.wave} hasn't ended yet.`, 409);
  }

  try {
    const data = await loadEventData(event, admin);
    const to = (await recipientsFor(admin, [teamId])).get(teamId) ?? [];
    const outcome = await sendTeamEmail(admin, event, data, teamId, kind, to, true);
    if (outcome === "sent") return json({ ok: true, outcome, recipients: to.length });
    if (outcome === "skipped") return fail("This team has no athlete email addresses.", 409, { outcome });
    if (outcome === "busy") return fail("That email is being sent right now - refresh in a moment.", 409, { outcome });
    return fail("The email couldn't be sent. Try again in a minute.", 502, { outcome });
  } catch {
    console.error("admin/results-emails: resend failed");
    return fail("The email couldn't be sent. Try again in a minute.", 500);
  }
}
