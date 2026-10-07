// SERVER-ONLY. Registration alerts to the organisers' own email addresses
// (set in Admin -> Registrations): spot booked, team confirmed, team
// withdrawn. Includes athletes' names, phone numbers and emails (the
// organiser's choice, 2026-10-07) - never ID numbers, addresses or
// medical answers. Never makes the caller fail.
import type { createAdminClient } from "@/lib/supabase/admin";
import { brandFor, EventRow } from "@/lib/events";
import { emailConfigured, escapeHtml, fromAddress, sendViaResend } from "@/lib/resultsEmail";
import { baseUrl } from "@/lib/partnerLink";

type Admin = ReturnType<typeof createAdminClient>;

export type AlertKind = "booked" | "confirmed" | "withdrawn";
export const MAX_ALERT_EMAILS = 10;

export type AlertSettings = {
  emails: string[];
  on_booked: boolean;
  on_confirmed: boolean;
  on_withdrawn: boolean;
};

export const DEFAULT_ALERTS: AlertSettings = { emails: [], on_booked: true, on_confirmed: true, on_withdrawn: true };

export async function loadAlertSettings(admin: Admin, eventId: string): Promise<AlertSettings> {
  const { data } = await admin
    .from("event_alerts")
    .select("emails, on_booked, on_confirmed, on_withdrawn")
    .eq("event_id", eventId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_ALERTS };
  return {
    emails: Array.isArray(data.emails) ? (data.emails as string[]) : [],
    on_booked: data.on_booked !== false,
    on_confirmed: data.on_confirmed !== false,
    on_withdrawn: data.on_withdrawn !== false,
  };
}

const TITLES: Record<AlertKind, (team: string) => string> = {
  booked: (t) => `Spot booked: ${t}`,
  confirmed: (t) => `${t} is confirmed`,
  withdrawn: (t) => `${t} was withdrawn`,
};

const SUBJECT_WORD: Record<AlertKind, string> = {
  booked: "Spot booked",
  confirmed: "Team confirmed",
  withdrawn: "Team withdrawn",
};

type Member = { position: number; first_name: string; surname: string; phone: string; email: string; signed_at: string | null; paid: boolean };

/** Builds and sends the alert. `test` sends a sample to the given addresses. */
export async function sendAdminAlert(
  admin: Admin,
  event: EventRow,
  teamId: string,
  kind: AlertKind,
  opts: { to?: string[]; test?: boolean } = {}
): Promise<boolean> {
  try {
    if (!emailConfigured()) return false;
    const settings = opts.to ? { ...DEFAULT_ALERTS, emails: opts.to } : await loadAlertSettings(admin, event.id);
    if (!opts.to) {
      if (kind === "booked" && !settings.on_booked) return false;
      if (kind === "confirmed" && !settings.on_confirmed) return false;
      if (kind === "withdrawn" && !settings.on_withdrawn) return false;
    }
    if (settings.emails.length === 0) return false;

    const [{ data: team }, { data: memberRows }, { data: allTeams }] = await Promise.all([
      admin.from("teams").select("id, team_name, division, status").eq("id", teamId).maybeSingle(),
      admin
        .from("team_members")
        .select("id, position, first_name, surname, phone, email, signed_at, paid")
        .eq("team_id", teamId)
        .order("position", { ascending: true }),
      admin.from("teams").select("status, division").eq("event_id", event.id),
    ]);
    if (!team) return false;
    const members = (memberRows ?? []) as (Member & { id: number })[];

    // Medical notes: only whether there are any, never the answers.
    let medical = false;
    if (members.length) {
      const { data: med } = await admin
        .from("member_medical")
        .select("answers, details, extra")
        .in(
          "member_id",
          members.map((m) => m.id)
        );
      medical = (med ?? []).some(
        (r) =>
          Object.values((r.answers as Record<string, string>) ?? {}).some((a) => a === "yes" || a === "unknown") ||
          !!(r.details as string | null)?.trim() ||
          Object.values(((r.extra as { notes?: Record<string, string> } | null)?.notes) ?? {}).some((n) => !!n?.trim())
      );
    }

    const live = (allTeams ?? []).filter((t) => t.status !== "withdrawn");
    const confirmed = live.filter((t) => t.status === "confirmed").length;
    const booked = live.length - confirmed;
    const by = (d: string) => live.filter((t) => t.division === d).length;
    const signed = members.filter((m) => m.signed_at).length;
    const paidCount = members.filter((m) => m.paid).length;
    const teamName = team.team_name ?? `Team ${teamId}`;
    const logo = `${baseUrl()}${brandFor(event).logo}`;
    const adminUrl = `${baseUrl()}/admin`;

    const row = (label: string, value: string) =>
      `<tr><td style="padding:4px 12px 4px 0;color:#5B6680;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(
        label
      )}</td><td style="padding:4px 0;font-size:14px;">${value}</td></tr>`;
    const athletes = members
      .map(
        (m) =>
          `<div style="margin-bottom:6px;"><b>${escapeHtml(`${m.first_name} ${m.surname}`)}</b>${
            m.signed_at ? "" : ' <span style="color:#C2410C;">(not signed yet)</span>'
          }<br><a href="tel:${escapeHtml(m.phone)}" style="color:#1D6FD1;">${escapeHtml(m.phone)}</a> · <a href="mailto:${escapeHtml(
            m.email
          )}" style="color:#1D6FD1;">${escapeHtml(m.email)}</a></div>`
      )
      .join("");

    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#EEF2F7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F7;padding:20px 0;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#111827;">
<tr><td style="background:#050B18;padding:16px 20px;">
<img src="${logo}" width="44" height="44" alt="" style="border-radius:22px;vertical-align:middle;">
<span style="color:#ffffff;font-size:16px;font-weight:bold;vertical-align:middle;margin-left:10px;">${escapeHtml(event.name)} · registrations</span>
</td></tr>
<tr><td style="padding:20px 24px 8px 24px;">
${opts.test ? '<p style="margin:0 0 10px 0;padding:8px;border:1px dashed #2E9BFF;font-size:13px;">This is a test email - it shows what a registration alert looks like.</p>' : ""}
<div style="font-size:20px;font-weight:bold;margin-bottom:10px;">${escapeHtml(TITLES[kind](teamName))}</div>
<table role="presentation" cellpadding="0" cellspacing="0">
${row("Team ID", `<b style="font-family:Consolas,Menlo,monospace;">${escapeHtml(teamId)}</b>`)}
${row("Category", escapeHtml(team.division ?? "-"))}
${row("Athletes", athletes || "-")}
${row("Signed", `${signed} of ${members.length || 2}`)}
${row("Paid", members.length ? `${paidCount} of ${members.length} athletes` : "-")}
${row("Medical notes", medical ? "Yes - see the medic sheet in admin" : "None")}
</table>
<p style="margin:14px 0 0 0;font-size:13px;color:#5B6680;">Totals: ${live.length} team${live.length === 1 ? "" : "s"} (${confirmed} confirmed, ${booked} booked) · Men ${by(
      "Men"
    )} · Women ${by("Women")} · Mixed ${by("Mixed")}</p>
<p style="text-align:center;margin:18px 0;"><a href="${adminUrl}" style="display:inline-block;padding:11px 20px;border-radius:6px;background:#2E9BFF;color:#ffffff;font-weight:bold;text-decoration:none;">Open registrations</a></p>
</td></tr>
<tr><td style="background:#F4F6FA;padding:12px 20px;font-size:11px;color:#5B6680;line-height:1.5;">
Contains personal information - don't forward. ID numbers, addresses and medical answers are only in the admin.<br>
You get this because your address is on the registration alerts list in the admin.
</td></tr>
</table></td></tr></table></body></html>`;

    const text = [
      opts.test ? "TEST EMAIL" : "",
      TITLES[kind](teamName),
      `Team ID: ${teamId} · ${team.division ?? "-"}`,
      ...members.map((m) => `${m.first_name} ${m.surname}${m.signed_at ? "" : " (not signed yet)"} · ${m.phone} · ${m.email}`),
      `Signed ${signed} of ${members.length || 2} · Paid ${paidCount} of ${members.length}`,
      `Totals: ${live.length} teams (${confirmed} confirmed, ${booked} booked)`,
      adminUrl,
    ]
      .filter(Boolean)
      .join("\n");

    const r = await sendViaResend({
      from: fromAddress(event),
      to: settings.emails,
      subject: `${opts.test ? "[Test] " : ""}${SUBJECT_WORD[kind]}: ${teamName} (${teamId}) - ${live.length} team${live.length === 1 ? "" : "s"} so far`,
      html,
      text,
    });
    return r.ok;
  } catch {
    console.error("adminAlerts: send failed");
    return false;
  }
}

/** For routes: send without ever waiting more than a few seconds. */
export async function alertSafely(admin: Admin, event: EventRow, teamId: string, kind: AlertKind): Promise<void> {
  await Promise.race([
    sendAdminAlert(admin, event, teamId, kind).catch(() => false),
    new Promise((resolve) => setTimeout(resolve, 6000)),
  ]);
}
