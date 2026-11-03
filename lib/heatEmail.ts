// SERVER-ONLY. "You're in Heat N" email: each team's heat, start time and
// when to arrive (45 minutes before, for registration and warm-up). Sent
// by the admin from Registrations (app/api/admin/heat-emails), one email
// per team to both athletes. Each send is recorded in heat_emails
// (sql/025) so the admin sees who has it and whose heat changed since.
import type { createAdminClient } from "@/lib/supabase/admin";
import { brandFor, EventRow } from "@/lib/events";
import { emailConfigured, escapeHtml, fromAddress, sendViaResend } from "@/lib/resultsEmail";
import { baseUrl, signUrl } from "@/lib/partnerLink";

type Admin = ReturnType<typeof createAdminClient>;

/** Organiser's choice (2026-11-03): arrive 45 minutes before the heat. */
export const ARRIVE_MINUTES_BEFORE = 45;

export type HeatEmailTeam = {
  id: string;
  team_name: string | null;
  wave: number;
  scheduled_start: string;
  members: { position: number; first_name: string; surname: string; email: string; signed_at: string | null }[];
};

// Heat times are stored as plain wall-clock times in the UTC fields
// (lib/teamId.ts), so they are read back with getUTC*.
function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function heatTimes(scheduledStart: string) {
  const start = new Date(scheduledStart).getTime();
  return { start: hhmm(start), arrive: hhmm(start - ARRIVE_MINUTES_BEFORE * 60_000) };
}

function dayLabel(eventDate: string): string {
  const [y, m, d] = eventDate.slice(0, 10).split("-").map(Number);
  // en-GB gives "Saturday 7 November" (en-ZA would add a comma and a zero).
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d))
  );
}

export function renderHeatEmail(event: EventRow, team: HeatEmailTeam, opts: { test?: boolean } = {}) {
  const t = heatTimes(team.scheduled_start);
  const teamName = team.team_name || `Team ${team.id}`;
  const members = [...team.members].sort((a, b) => a.position - b.position);
  const firsts = members.map((m) => m.first_name.trim()).filter(Boolean);
  const hello = firsts.length === 2 ? `${firsts[0]} and ${firsts[1]}` : firsts[0] ?? "there";
  const unsigned = members.find((m) => !m.signed_at);
  const day = dayLabel(event.event_date);
  const venue = event.venue ?? "the venue";
  const logo = `${baseUrl()}${brandFor(event).logo}`;
  const dv = `${baseUrl()}/brand/datavera-light.png`;
  const box = `${baseUrl()}/partners/the-box.png`;
  const m2m = `${baseUrl()}/partners/mission-to-move.png`;
  const login = `${baseUrl()}/login`;

  const signBlock = unsigned
    ? `<div style="margin:14px 0;padding:12px;border:1px solid #F0B429;background:#FFF8E6;border-radius:8px;font-size:14px;">
<b>${escapeHtml(unsigned.first_name)} still needs to sign</b> before race day - you can't race without both signatures.<br>
<a href="${signUrl(team.id)}" style="display:inline-block;margin-top:8px;padding:9px 14px;border-radius:6px;background:#F0B429;color:#111827;font-weight:bold;text-decoration:none;">Sign now</a>
</div>`
    : "";

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#EEF2F7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F7;padding:20px 0;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#111827;">
<tr><td align="center" style="background:#050B18;padding:24px 20px;">
<img src="${logo}" width="84" height="84" alt="${escapeHtml(event.name)}" style="border-radius:42px;display:block;">
<div style="font-size:24px;font-weight:bold;color:#ffffff;margin-top:14px;">You're in Heat ${team.wave}</div>
<div style="font-size:16px;font-weight:bold;color:#2E9BFF;margin-top:4px;">${escapeHtml(day)} · ${escapeHtml(venue)}</div>
</td></tr>
<tr><td style="padding:20px 24px 8px 24px;font-size:15px;line-height:1.55;">
${opts.test ? '<p style="margin:0 0 10px 0;padding:8px;border:1px dashed #2E9BFF;font-size:13px;">This is a test email - it shows what the teams will get.</p>' : ""}
<p style="margin:0 0 12px 0;">Hi ${escapeHtml(hello)},</p>
<p style="margin:0 0 12px 0;">Here's your race-day plan for <b>${escapeHtml(teamName)}</b> (${escapeHtml(team.id)}).</p>
<div style="border:2px dashed #2E9BFF;border-radius:12px;background:#F3F8FF;padding:14px;text-align:center;">
<div style="font-size:11px;letter-spacing:2px;color:#5B6680;">YOUR HEAT</div>
<div style="font-size:34px;font-weight:bold;color:#0B1220;">HEAT ${team.wave}</div>
<div style="font-size:11px;letter-spacing:2px;color:#5B6680;margin-top:6px;">START TIME</div>
<div style="font-size:30px;font-weight:bold;color:#0B4A8F;font-family:Consolas,Menlo,monospace;">${t.start}</div>
<div style="margin-top:10px;padding:10px;border:1px solid #D7DFEC;border-radius:8px;background:#ffffff;font-size:14px;">
Arrive by <b style="font-size:18px;">${t.arrive}</b><br><span style="color:#5B6680;font-size:13px;">for registration and warm-up (${ARRIVE_MINUTES_BEFORE} minutes before your heat)</span>
</div>
</div>
${signBlock}
<p style="margin:14px 0 4px 0;"><b>On the day</b></p>
<ol style="margin:0;padding-left:18px;">
<li style="margin-bottom:4px;">Arrive at ${escapeHtml(venue)} by <b>${t.arrive}</b> and register with your Team ID <b>${escapeHtml(team.id)}</b> (or show your Island Pass).</li>
<li style="margin-bottom:4px;">Warm up and be at the start line before <b>${t.start}</b> - heats start on time.</li>
<li style="margin-bottom:4px;">A 400m run before each of the 12 stations. Leaving station 12 is your finish.</li>
</ol>
<p style="text-align:center;margin:20px 0;"><a href="${login}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#2E9BFF;color:#ffffff;font-weight:bold;text-decoration:none;">Follow your race live</a></p>
<p style="margin:0 0 6px 0;font-size:13px;color:#5B6680;">Your team login is <b>${escapeHtml(team.id.toLowerCase())}</b> with the password you chose when you signed up.</p>
</td></tr>
<tr><td align="center" style="background:#F4F6FA;padding:16px 20px;font-size:11px;color:#5B6680;line-height:1.5;">
<img src="${box}" height="30" alt="The Box" style="height:30px;margin:0 8px;"><img src="${m2m}" height="30" alt="Mission To Move" style="height:30px;margin:0 8px;">
<div style="margin-top:8px;">You're getting this because you registered for ${escapeHtml(event.name)} (Team ${escapeHtml(team.id)}).</div>
<img src="${dv}" height="20" alt="by Datavera Analytics" style="height:20px;margin-top:8px;">
</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    opts.test ? "TEST EMAIL" : "",
    `Hi ${hello},`,
    "",
    `${teamName} (${team.id}) is in Heat ${team.wave} at ${event.name}, ${day}, ${venue}.`,
    `Start time: ${t.start}`,
    `Arrive by: ${t.arrive} for registration and warm-up (${ARRIVE_MINUTES_BEFORE} minutes before your heat).`,
    unsigned ? `${unsigned.first_name} still needs to sign before race day: ${signUrl(team.id)}` : "",
    "",
    `Register with your Team ID ${team.id} (or your Island Pass). A 400m run before each of the 12 stations; leaving station 12 is your finish.`,
    `Follow your race live: ${login} (username ${team.id.toLowerCase()})`,
  ]
    .filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""))
    .join("\n");

  const subject = `${opts.test ? "[Test] " : ""}${event.name}: ${teamName} is in Heat ${team.wave} - start ${t.start}, arrive by ${t.arrive}`;
  return { subject, html, text };
}

/** Loads the teams in a heat that hasn't started (optionally only some). */
export async function loadHeatEmailTeams(admin: Admin, event: EventRow, onlyIds?: string[]): Promise<HeatEmailTeam[]> {
  let q = admin
    .from("teams")
    .select("id, team_name, wave, status")
    .eq("event_id", event.id)
    .neq("status", "withdrawn")
    .not("wave", "is", null)
    .order("id");
  if (onlyIds) q = q.in("id", onlyIds);
  const [{ data: teams }, { data: waves }] = await Promise.all([
    q,
    admin.from("waves").select("wave_number, scheduled_start, actual_start").eq("event_id", event.id),
  ]);
  const waveBy = new Map((waves ?? []).map((w) => [w.wave_number as number, w]));
  const ids = (teams ?? []).map((t) => t.id as string);
  const { data: members } = ids.length
    ? await admin.from("team_members").select("team_id, position, first_name, surname, email, signed_at").in("team_id", ids)
    : { data: [] as { team_id: string; position: number; first_name: string; surname: string; email: string; signed_at: string | null }[] };
  const out: HeatEmailTeam[] = [];
  for (const t of teams ?? []) {
    const w = waveBy.get(t.wave as number);
    if (!w || w.actual_start) continue; // only heats still to come
    out.push({
      id: t.id as string,
      team_name: t.team_name as string | null,
      wave: t.wave as number,
      scheduled_start: w.scheduled_start as string,
      members: (members ?? []).filter((m) => m.team_id === t.id),
    });
  }
  return out;
}

/** Sends one team's heat email to both athletes and records it. */
export async function sendHeatEmail(admin: Admin, event: EventRow, team: HeatEmailTeam): Promise<"sent" | "failed" | "no_email"> {
  if (!emailConfigured()) return "failed";
  const to = [...new Set(team.members.map((m) => (m.email ?? "").trim().toLowerCase()).filter(Boolean))];
  if (to.length === 0) return "no_email";
  const msg = renderHeatEmail(event, team);
  const r = await sendViaResend({ from: fromAddress(event), to, subject: msg.subject, html: msg.html, text: msg.text });
  await admin.from("heat_emails").upsert(
    {
      team_id: team.id,
      wave: team.wave,
      scheduled_start: team.scheduled_start,
      status: r.ok ? "sent" : "failed",
      recipients: to.length,
      error: r.ok ? null : "send failed",
      sent_at: new Date().toISOString(),
    },
    { onConflict: "team_id" }
  );
  return r.ok ? "sent" : "failed";
}
