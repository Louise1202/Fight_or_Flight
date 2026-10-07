// SERVER-ONLY. Results emails to the athletes of each team:
//   'heat'  - when the team's heat ends (everyone finished, time limit or
//             the admin ended it). Not when the team itself finishes.
//   'final' - when the event is finished and locked.
// Each team gets each kind at most once (result_emails, sql/020), unless
// the admin presses "Send again". Withdrawn teams never. Teams with no
// athlete email addresses are recorded as 'skipped'.
//
// Sent through the Resend REST API. With no RESEND_API_KEY nothing is sent
// and nothing throws - race day must never fail because of email.
//
// POPIA: nothing personal is ever logged, and result_emails.error holds an
// HTTP status only.
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getEventById } from "@/lib/activeEvent";
import { brandFor, EventRow, formatEventDate } from "@/lib/events";
import { chunk, fetchAll } from "@/lib/fetchAll";
import { loadEventData, EventData } from "@/components/results/data";
import { formatDuration } from "@/lib/timing";
import { buildTeamResult, createResultLink, ordinal, publicBaseUrl, TeamResult } from "@/lib/teamResult";

type AdminClient = ReturnType<typeof createAdminClient>;

export type EmailKind = "heat" | "final";

export const MAX_SENDS_PER_RUN = 40;
const SEND_GAP_MS = 600; // Resend allows about 2 requests a second

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export function fromAddress(event: Pick<EventRow, "name">): string {
  if (process.env.RESULTS_EMAIL_FROM) return process.env.RESULTS_EMAIL_FROM;
  // Display names can't contain quotes or angle brackets unescaped.
  const name = event.name.replace(/["<>\r\n]/g, "").trim() || "Survivor";
  return `${name} <results@betterdesk.app>`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------
// Settings (sql/020 columns, read separately so the rest of the app keeps
// working before the migration is applied)
// ---------------------------------------------------------------------

export type EmailSettings = { email_results_auto: boolean; email_final_auto: boolean };

/** null when the sql/020 columns don't exist yet. */
export async function loadEmailSettings(admin: AdminClient, eventId: string): Promise<EmailSettings | null> {
  const { data, error } = await admin
    .from("events")
    .select("email_results_auto, email_final_auto")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    email_results_auto: data.email_results_auto !== false,
    email_final_auto: data.email_final_auto !== false,
  };
}

// ---------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/** Athlete email addresses per team, cleaned and de-duplicated. */
export async function recipientsFor(admin: AdminClient, teamIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const ids of chunk(teamIds)) {
    const rows = await fetchAll<{ id: number; team_id: string; email: string | null }>((from, to) =>
      admin.from("team_members").select("id, team_id, email").in("team_id", ids).order("id", { ascending: true }).range(from, to)
    );
    for (const r of rows) {
      const e = (r.email ?? "").trim().toLowerCase();
      if (!e || e.length > 254 || !EMAIL_RE.test(e)) continue;
      const list = out.get(r.team_id) ?? [];
      if (!list.includes(e)) list.push(e);
      out.set(r.team_id, list);
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------

export function escapeHtml(v: string | null | undefined): string {
  return (v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function athletesLine(r: TeamResult): string {
  return [r.team.athlete_1, r.team.athlete_2].map((n) => (n ?? "").trim()).filter(Boolean).join(" & ");
}

function divisionName(r: TeamResult): string {
  return r.team.division?.trim() || "your division";
}

export type RenderedEmail = { subject: string; html: string; text: string };

export function renderResultsEmail(
  r: TeamResult,
  kind: EmailKind,
  links: { splits: string; card: string },
  opts: { test?: boolean } = {}
): RenderedEmail {
  const ev = r.event;
  const base = publicBaseUrl();
  const brand = brandFor(ev);
  const survivor = ev.theme === "survivor";
  const dark = survivor ? "#050B18" : "#0E0D0C";
  const accent = survivor ? "#2E9BFF" : "#E8262D";
  const accentText = survivor ? "#1570D6" : "#B81D23"; // readable on white
  const muted = survivor ? "#8A9BBC" : "#7A756C";

  const finished = r.status === "finished" && r.timeMs != null;
  const isFinal = kind === "final";
  const soFar = !isFinal && r.heatsToGo > 0;
  const time = formatDuration(r.timeMs ?? 0);
  const div = divisionName(r);
  const place = r.divisionRank != null ? ordinal(r.divisionRank) : null;
  const dateLabel = formatEventDate(ev.event_date);

  let subject: string;
  if (isFinal) {
    subject = finished && place ? `Final result: ${place} in ${div} - ${ev.name}` : `${ev.name}: thank you for racing`;
  } else if (finished) {
    subject = `Your ${ev.name} results: ${time}${place ? ` · ${place} in ${div}${soFar ? " so far" : ""}` : ""}`;
  } else {
    subject = `Your ${ev.name} results: ${r.stationsDone} of ${r.stationsTotal} stations in ${time}`;
  }
  if (opts.test) subject = `[TEST] ${subject}`;

  const headline = finished ? "CONGRATULATIONS!" : "WHAT A FIGHT!";
  const athletes = athletesLine(r);
  const metaBits = [athletes, r.team.division?.trim() || null, r.team.wave != null ? `Heat ${r.team.wave}` : null, r.team.id].filter(
    (x): x is string => !!x
  );
  const timeNote =
    r.heatEndReason === "time_limit" ? "heat time limit" : r.heatEndReason === "manual" ? "heat ended" : "when the heat ended";
  const heatsNote = soFar ? `so far - ${r.heatsToGo} heat${r.heatsToGo === 1 ? "" : "s"} to go` : "";

  // --- time row cells ---
  type Cell = { label: string; value: string; note?: string };
  const cells: Cell[] = finished
    ? [
        { label: "Official time", value: time, note: r.penaltySeconds > 0 ? `includes +${r.penaltySeconds}s penalty` : undefined },
        { label: `Place in ${div}`, value: place ?? "-", note: heatsNote || (r.divisionTeams ? `of ${r.divisionTeams} teams` : undefined) },
        { label: "Overall", value: r.overallRank != null ? ordinal(r.overallRank) : "-", note: `of ${r.overallTeams} teams` },
      ]
    : [
        { label: "Stations done", value: `${r.stationsDone}/${r.stationsTotal}` },
        { label: "Time", value: time, note: timeNote },
      ];
  const cellWidth = Math.floor(100 / cells.length);
  const cellsHtml = cells
    .map(
      (c) => `<td width="${cellWidth}%" valign="top" style="padding:14px 8px;text-align:center;border-right:1px solid #E3E8F0;">
<div style="font-size:12px;color:#5B6680;text-transform:uppercase;letter-spacing:1px;">${escapeHtml(c.label)}</div>
<div style="font-size:28px;font-weight:bold;color:${accentText};margin-top:4px;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(c.value)}</div>
${c.note ? `<div style="font-size:12px;color:#5B6680;margin-top:2px;">${escapeHtml(c.note)}</div>` : ""}
</td>`
    )
    .join("");

  // --- splits ---
  const splitRows = r.legs
    .map((l) => {
      const fastest = r.fastest && l.kind === "station" && l.stationIndex === r.fastest.stationIndex;
      const label = l.kind === "station" ? `${l.stationIndex}. ${l.label}` : l.label;
      const color = l.kind === "run" ? "#8892A6" : "#111827";
      const bg = fastest ? "background:#EAF3FF;" : "";
      const tag = fastest
        ? ` <span style="display:inline-block;font-size:10px;font-weight:bold;color:#ffffff;background:${accent};border-radius:3px;padding:2px 6px;margin-left:6px;">YOUR FASTEST STATION</span>`
        : "";
      return `<tr><td style="padding:7px 10px;border-bottom:1px solid #E3E8F0;font-size:14px;color:${color};${bg}">${escapeHtml(label)}${tag}</td>
<td align="right" style="padding:7px 10px;border-bottom:1px solid #E3E8F0;font-size:14px;color:${color};font-family:Consolas,Menlo,monospace;${bg}">${l.ms != null ? escapeHtml(formatDuration(l.ms)) : "-"}</td></tr>`;
    })
    .join("");

  const penaltyLine =
    r.penaltySeconds > 0
      ? `Penalties: +${r.penaltySeconds}s (${r.penalties.length} penalt${r.penalties.length === 1 ? "y" : "ies"}), already in your official time.`
      : "No penalties.";

  let recordLine = "";
  if (r.fastest && r.record) {
    recordLine = r.record.isThisTeam
      ? `Your ${r.record.name} time (${formatDuration(r.record.ms)}) is the fastest of the day${soFar ? " so far" : ""}!`
      : `Day's record at ${r.record.name}${soFar ? " so far" : ""}: ${formatDuration(r.record.ms)} by ${r.record.teamName}.`;
  }

  const intro = isFinal
    ? finished
      ? `The final places are in. You finished ${place ?? "-"} in ${div}.`
      : "The final places are in. Thank you for racing - here is how far you got."
    : finished
    ? `You crossed the line in ${time}.`
    : `The heat ended with you on station ${Math.min(r.stationsDone + 1, r.stationsTotal)}. Here is how far you got.`;

  const logoUrl = `${base}${brand.logo}`;
  const partnerImgs = brand.partners
    .map(
      (p) =>
        `<img src="${escapeHtml(base + p.src)}" alt="${escapeHtml(p.alt)}" height="40" style="height:40px;width:auto;margin:0 10px;border:0;vertical-align:middle;" />`
    )
    .join("");

  const btn = (href: string, label: string, primary: boolean) =>
    `<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;margin:6px;border-radius:6px;font-size:15px;font-weight:bold;text-decoration:none;${
      primary ? `background:${accent};color:#ffffff;` : `background:#ffffff;color:${accentText};border:2px solid ${accent};`
    }">${escapeHtml(label)}</a>`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#F2F5FA;font-family:Arial,Helvetica,sans-serif;color:#111827;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F5FA;">
<tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td align="center" bgcolor="${dark}" style="background:${dark};padding:28px 20px 24px 20px;">
${opts.test ? `<div style="font-size:12px;color:#FFD166;margin-bottom:8px;">TEST EMAIL - only sent to you</div>` : ""}
<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(ev.name)}" width="120" height="120" style="width:120px;height:120px;border-radius:60px;border:0;display:block;margin:0 auto;" />
<div style="font-size:22px;font-weight:bold;color:${accent};margin-top:14px;letter-spacing:1px;">${escapeHtml(ev.name.toUpperCase())}</div>
<div style="font-size:13px;color:${muted};margin-top:4px;">${escapeHtml(dateLabel)}${ev.venue ? ` · ${escapeHtml(ev.venue)}` : ""}</div>
<div style="font-size:24px;font-weight:bold;color:#ffffff;margin-top:20px;letter-spacing:1px;word-break:break-word;">${headline}</div>
<div style="font-size:22px;font-weight:bold;color:#ffffff;margin-top:8px;">${escapeHtml(r.team.team_name)}</div>
<div style="font-size:13px;color:${muted};margin-top:6px;">${metaBits.map(escapeHtml).join(" · ")}</div>
</td></tr>
<tr><td style="padding:18px 20px 4px 20px;font-size:15px;color:#111827;">${escapeHtml(intro)}</td></tr>
<tr><td style="padding:10px 20px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E3E8F0;border-radius:6px;"><tr>${cellsHtml}</tr></table>
</td></tr>
${
  splitRows
    ? `<tr><td style="padding:10px 20px 0 20px;font-size:13px;font-weight:bold;color:#5B6680;letter-spacing:1px;">SPLITS</td></tr>
<tr><td style="padding:6px 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${splitRows}</table></td></tr>`
    : ""
}
<tr><td style="padding:8px 20px;font-size:13px;color:#5B6680;">${escapeHtml(penaltyLine)}</td></tr>
${recordLine ? `<tr><td style="padding:2px 20px 8px 20px;font-size:14px;color:#111827;">${escapeHtml(recordLine)}</td></tr>` : ""}
<tr><td align="center" style="padding:14px 20px 22px 20px;">${btn(links.splits, "See all your splits", true)}${btn(links.card, "Save your result picture", false)}</td></tr>
<tr><td align="center" style="padding:18px 20px;border-top:1px solid #E3E8F0;background:#FAFBFD;">
<div>${partnerImgs}</div>
<div style="font-size:12px;color:#5B6680;margin-top:12px;">You're getting this because you registered for ${escapeHtml(ev.name)} (Team ${escapeHtml(r.team.id)}).</div>
<div style="margin-top:12px;"><img src="${escapeHtml(base + "/brand/datavera-light.png")}" alt="Datavera Analytics" height="22" style="height:22px;width:auto;border:0;" /></div>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const textLines = [
    opts.test ? "TEST EMAIL - only sent to you" : "",
    `${ev.name} · ${dateLabel}${ev.venue ? ` · ${ev.venue}` : ""}`,
    "",
    headline,
    r.team.team_name,
    metaBits.join(" · "),
    "",
    intro,
    "",
    ...cells.map((c) => `${c.label}: ${c.value}${c.note ? ` (${c.note})` : ""}`),
    "",
    r.legs.length ? "SPLITS" : "",
    ...r.legs.map((l) => {
      const label = l.kind === "station" ? `${l.stationIndex}. ${l.label}` : l.label;
      const mark = r.fastest && l.kind === "station" && l.stationIndex === r.fastest.stationIndex ? "  <- your fastest station" : "";
      return `${label}: ${l.ms != null ? formatDuration(l.ms) : "-"}${mark}`;
    }),
    "",
    penaltyLine,
    recordLine,
    "",
    `See all your splits: ${links.splits}`,
    `Save your result picture: ${links.card}`,
    "",
    `You're getting this because you registered for ${ev.name} (Team ${r.team.id}).`,
  ];
  const text = textLines.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");

  return { subject, html, text };
}

// ---------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------

type SendResult = { ok: true; id: string | null } | { ok: false; error: string };

export async function sendViaResend(msg: {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  /** Base64 file contents, e.g. the Island Pass PNG. */
  attachments?: { filename: string; content: string }[];
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "not configured" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(msg),
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json().catch(() => ({}))) as { id?: unknown };
    return { ok: true, id: typeof body.id === "string" ? body.id.slice(0, 100) : null };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** Claims the (team, kind) row so two runs can never both send. */
async function claim(admin: AdminClient, teamId: string, kind: EmailKind, force: boolean): Promise<boolean> {
  if (force) {
    const { data, error } = await admin
      .from("result_emails")
      .upsert(
        { team_id: teamId, kind, status: "failed", error: "sending", recipients: 0, provider_id: null, sent_at: new Date().toISOString() },
        { onConflict: "team_id,kind" }
      )
      .select("id");
    return !error && (data ?? []).length > 0;
  }
  const { error } = await admin
    .from("result_emails")
    .insert({ team_id: teamId, kind, status: "failed", error: "sending", recipients: 0 });
  return !error; // 23505 = someone else already has it
}

async function record(
  admin: AdminClient,
  teamId: string,
  kind: EmailKind,
  row: { status: "sent" | "failed" | "skipped"; recipients: number; provider_id?: string | null; error?: string | null }
) {
  await admin
    .from("result_emails")
    .update({
      status: row.status,
      recipients: row.recipients,
      provider_id: row.provider_id ?? null,
      error: row.error ? row.error.slice(0, 40) : null,
      sent_at: new Date().toISOString(),
    })
    .eq("team_id", teamId)
    .eq("kind", kind);
}

/** Builds links + email for one team. Creates a fresh personal link. */
async function composeFor(admin: AdminClient, result: TeamResult, kind: EmailKind, test: boolean): Promise<RenderedEmail> {
  const token = await createResultLink(admin, result.team.id);
  const base = publicBaseUrl();
  return renderResultsEmail(result, kind, { splits: `${base}/r/${token}`, card: `${base}/r/${token}/card` }, { test });
}

export type SendOutcome = "sent" | "failed" | "skipped" | "busy" | "not_configured";

/**
 * Sends one kind of email to one team and records it. `force` = the admin
 * pressed "Send again" (replaces the earlier record).
 */
export async function sendTeamEmail(
  admin: AdminClient,
  event: EventRow,
  data: EventData,
  teamId: string,
  kind: EmailKind,
  recipients: string[],
  force = false
): Promise<SendOutcome> {
  if (!emailConfigured()) return "not_configured";
  const result = buildTeamResult(event, data, teamId);
  if (!result || result.team.status === "withdrawn") return "skipped";
  if (!(await claim(admin, teamId, kind, force))) return "busy";

  if (recipients.length === 0) {
    await record(admin, teamId, kind, { status: "skipped", recipients: 0, error: "no email" });
    return "skipped";
  }
  try {
    const email = await composeFor(admin, result, kind, false);
    const sent = await sendViaResend({ from: fromAddress(event), to: recipients, ...email });
    if (sent.ok) {
      await record(admin, teamId, kind, { status: "sent", recipients: recipients.length, provider_id: sent.id });
      return "sent";
    }
    await record(admin, teamId, kind, { status: "failed", recipients: recipients.length, error: sent.error });
    return "failed";
  } catch {
    await record(admin, teamId, kind, { status: "failed", recipients: recipients.length, error: "build" }).catch(() => null);
    return "failed";
  }
}

/** A test copy of a team's heat-results email to one address. No result_emails row. */
export async function sendTestEmail(admin: AdminClient, event: EventRow, teamId: string, to: string): Promise<SendResult> {
  if (!emailConfigured()) return { ok: false, error: "not configured" };
  const data = await loadEventData(event, admin);
  const result = buildTeamResult(event, data, teamId);
  if (!result) return { ok: false, error: "no team" };
  const email = await composeFor(admin, result, "heat", true);
  return sendViaResend({ from: fromAddress(event), to: [to], ...email });
}

/** The email as HTML for the admin's preview (no link is created). */
export async function previewEmail(admin: AdminClient, event: EventRow, teamId: string, kind: EmailKind): Promise<RenderedEmail | null> {
  const data = await loadEventData(event, admin);
  const result = buildTeamResult(event, data, teamId);
  if (!result) return null;
  const base = publicBaseUrl();
  return renderResultsEmail(result, kind, { splits: `${base}/r/preview-link`, card: `${base}/r/preview-link/card` }, { test: true });
}

export function isValidEmail(v: unknown): v is string {
  return typeof v === "string" && v.length <= 254 && EMAIL_RE.test(v.trim());
}

// ---------------------------------------------------------------------
// The automatic run (cron every minute, and right after a heat ends or
// the event is locked)
// ---------------------------------------------------------------------

export type ProcessSummary = {
  configured: boolean;
  eventId: string | null;
  closedHeats: number[];
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
  note?: string;
};

/** Heats past their time limit with no judge phone online to close them. Same rule as /api/waves/auto-close. */
async function closeOverdueHeats(admin: AdminClient, event: EventRow): Promise<number[]> {
  if (event.locked) return [];
  const { data: running, error } = await admin
    .from("waves")
    .select("wave_number, actual_start")
    .eq("event_id", event.id)
    .not("actual_start", "is", null)
    .is("actual_end", null);
  if (error) return [];
  const closed: number[] = [];
  for (const w of running ?? []) {
    const limitAt = new Date(w.actual_start as string).getTime() + event.heat_minutes * 60 * 1000;
    if (Date.now() < limitAt) continue;
    const { data } = await admin
      .from("waves")
      // +1 ms - see app/api/waves/auto-close/route.ts
      .update({ actual_end: new Date(limitAt + 1).toISOString(), end_reason: "time_limit" })
      .eq("event_id", event.id)
      .eq("wave_number", w.wave_number)
      .is("actual_end", null)
      .select("wave_number")
      .maybeSingle();
    if (data) closed.push(w.wave_number as number);
  }
  return closed;
}

/**
 * For the active event (or the given one): closes overdue heats, then
 * emails every team whose heat has ended and hasn't had its 'heat' email,
 * and - once the event is locked - every team's 'final' email.
 * At most 40 sends per call; the rest go on the next run. Never throws.
 */
export async function processResultEmails(eventId?: string, opts: { budgetMs?: number } = {}): Promise<ProcessSummary> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 45000;
  const summary: ProcessSummary = {
    configured: emailConfigured(),
    eventId: null,
    closedHeats: [],
    sent: 0,
    failed: 0,
    skipped: 0,
    remaining: 0,
  };
  try {
    const admin = createAdminClient();
    const event = eventId ? await getEventById(eventId, admin) : await getActiveEvent(admin);
    if (!event) return { ...summary, note: "no event" };
    summary.eventId = event.id;

    summary.closedHeats = await closeOverdueHeats(admin, event);
    if (!summary.configured) return { ...summary, note: "not configured" };

    const settings = await loadEmailSettings(admin, event.id);
    if (!settings) return { ...summary, note: "sql/020 not applied" };

    const doHeat = settings.email_results_auto && !event.locked; // once locked, the final email covers it
    const doFinal = settings.email_final_auto && event.locked;
    if (!doHeat && !doFinal) return { ...summary, note: "automatic emails are off" };

    // Already handled rows for this event's teams.
    const done = await fetchAll<{ id: number; team_id: string; kind: EmailKind }>((from, to) =>
      admin
        .from("result_emails")
        .select("id, team_id, kind, teams!inner(event_id)")
        .eq("teams.event_id", event.id)
        .order("id", { ascending: true })
        .range(from, to)
    );
    const doneKey = new Set(done.map((d) => `${d.team_id}:${d.kind}`));

    const { data: teamRows, error: teamErr } = await admin
      .from("teams")
      .select("id, wave, status")
      .eq("event_id", event.id)
      .neq("status", "withdrawn")
      .order("id");
    if (teamErr) return { ...summary, note: "teams query failed" };
    const { data: waveRows } = await admin
      .from("waves")
      .select("wave_number, actual_start, actual_end")
      .eq("event_id", event.id);
    const ended = new Set((waveRows ?? []).filter((w) => w.actual_start && w.actual_end).map((w) => w.wave_number as number));
    const started_ = new Set((waveRows ?? []).filter((w) => w.actual_start).map((w) => w.wave_number as number));

    const queue: { teamId: string; kind: EmailKind }[] = [];
    for (const t of teamRows ?? []) {
      if (doHeat && t.wave != null && ended.has(t.wave) && !doneKey.has(`${t.id}:heat`)) queue.push({ teamId: t.id, kind: "heat" });
      // Final places only for teams that actually raced.
      if (doFinal && t.wave != null && started_.has(t.wave) && !doneKey.has(`${t.id}:final`)) queue.push({ teamId: t.id, kind: "final" });
    }
    if (queue.length === 0) return summary;

    const data = await loadEventData(event, admin);
    const emails = await recipientsFor(admin, [...new Set(queue.map((q) => q.teamId))]);

    let sends = 0;
    for (let i = 0; i < queue.length; i++) {
      if (sends >= MAX_SENDS_PER_RUN || Date.now() - started > budget) {
        summary.remaining = queue.length - i;
        break;
      }
      const q = queue[i];
      const to = emails.get(q.teamId) ?? [];
      const outcome = await sendTeamEmail(admin, event, data, q.teamId, q.kind, to);
      if (outcome === "sent") summary.sent++;
      else if (outcome === "failed") summary.failed++;
      else if (outcome === "skipped") summary.skipped++;
      if (outcome === "sent" || outcome === "failed") {
        sends++;
        await sleep(SEND_GAP_MS);
      }
    }
    return summary;
  } catch {
    // Never personal data in logs - just that it happened.
    console.error("results-emails: run failed");
    return { ...summary, note: "run failed" };
  }
}

/** For routes that must never fail because of email: awaits a short run, swallows everything. */
export async function processResultEmailsSafely(eventId: string, budgetMs: number): Promise<void> {
  try {
    await processResultEmails(eventId, { budgetMs });
  } catch {
    /* never block the action */
  }
}
