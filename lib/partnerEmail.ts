// SERVER-ONLY. Emails for a team whose second athlete signs later:
//  - to athlete 2: "<name> signed you up - complete your registration"
//  - to athlete 1: "Spot booked - waiting for your partner"
// Never makes the sign-up fail: returns false if sending isn't set up.
import { brandFor, EventRow, formatEventDate } from "@/lib/events";
import { emailConfigured, escapeHtml, fromAddress, sendViaResend } from "@/lib/resultsEmail";
import { baseUrl, signUrl } from "@/lib/partnerLink";

type Person = { first_name: string; surname: string; email: string };

export type PartnerEmailInput = {
  event: EventRow;
  teamId: string;
  teamName: string;
  booker: Person;
  partner: Person;
};

function frame(event: EventRow, title: string, subtitle: string, body: string, teamId: string): string {
  const logo = `${baseUrl()}${brandFor(event).logo}`;
  const dv = `${baseUrl()}/brand/datavera-light.png`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#EEF2F7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F7;padding:20px 0;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#111827;">
<tr><td align="center" style="background:#050B18;padding:26px 20px;">
<img src="${logo}" width="96" height="96" alt="${escapeHtml(event.name)}" style="border-radius:48px;display:block;">
<div style="font-size:24px;font-weight:bold;color:#ffffff;margin-top:16px;">${escapeHtml(title)}</div>
<div style="font-size:16px;font-weight:bold;color:#2E9BFF;margin-top:4px;">${escapeHtml(subtitle)}</div>
</td></tr>
<tr><td style="padding:22px 24px;font-size:15px;line-height:1.55;">${body}</td></tr>
<tr><td align="center" style="background:#F4F6FA;padding:16px 20px;font-size:11px;color:#5B6680;line-height:1.5;">
<div>You're getting this because of a registration for ${escapeHtml(event.name)} (Team ${escapeHtml(teamId)}).</div>
<img src="${dv}" height="20" alt="by Datavera Analytics" style="height:20px;margin-top:8px;">
</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="text-align:center;margin:20px 0;"><a href="${href}" style="display:inline-block;padding:13px 22px;border-radius:6px;background:#2E9BFF;color:#ffffff;font-weight:bold;text-decoration:none;font-size:16px;">${escapeHtml(label)}</a></p>`;
}

/** To athlete 2: the link to fill in their own details and sign. */
export async function sendPartnerInvite(d: PartnerEmailInput): Promise<boolean> {
  if (!emailConfigured()) return false;
  const link = signUrl(d.teamId);
  const date = formatEventDate(d.event.event_date);
  const by = d.booker.first_name.trim();
  const body = `<p style="margin:0 0 12px 0;">Hi ${escapeHtml(d.partner.first_name.trim())},</p>
<p style="margin:0 0 12px 0;"><b>${escapeHtml(by)}</b> signed up <b>${escapeHtml(d.teamName)}</b> (${escapeHtml(d.teamId)}) for ${escapeHtml(
    d.event.name
  )} on ${escapeHtml(date)}${d.event.venue ? ` at ${escapeHtml(d.event.venue)}` : ""}, with you as their partner.</p>
<p style="margin:0 0 12px 0;">Your spot is <b>booked</b>. To <b>confirm</b> it, fill in your own details, emergency contact and medical questions, read the waiver and sign with your finger. It takes about 5 minutes.</p>
${button(link, "Complete my registration")}
<p style="margin:0;font-size:13px;color:#5B6680;">This link is personal - please don't forward it. If the button doesn't work, copy this into your browser:<br><span style="word-break:break-all;">${escapeHtml(link)}</span></p>`;
  const text = [
    `Hi ${d.partner.first_name.trim()},`,
    "",
    `${by} signed up ${d.teamName} (${d.teamId}) for ${d.event.name} on ${date}, with you as their partner.`,
    "Your spot is booked. To confirm it, fill in your own details and medical questions and sign:",
    link,
  ].join("\n");
  const r = await sendViaResend({
    from: fromAddress(d.event),
    to: [d.partner.email],
    subject: `${by} signed you up for ${d.event.name} - complete your registration (${d.teamId})`,
    html: frame(d.event, "You've been signed up!", "One step left: your signature", body, d.teamId),
    text,
  });
  return r.ok;
}

/** To athlete 1: the spot is booked, waiting for the partner. */
export async function sendSpotBooked(d: PartnerEmailInput): Promise<boolean> {
  if (!emailConfigured()) return false;
  const partner = d.partner.first_name.trim();
  const pay = d.event.entry_fee || d.event.bank_details;
  const body = `<p style="margin:0 0 12px 0;">Hi ${escapeHtml(d.booker.first_name.trim())},</p>
<p style="margin:0 0 12px 0;"><b>${escapeHtml(d.teamName)}</b> has a spot booked for ${escapeHtml(d.event.name)}. Your Team ID is <b style="font-family:Consolas,Menlo,monospace;font-size:18px;">${escapeHtml(
    d.teamId
  )}</b>.</p>
<p style="margin:0 0 12px 0;">We've emailed <b>${escapeHtml(partner)}</b> a link to fill in their details and sign. Your spot is <b>confirmed</b> as soon as ${escapeHtml(
    partner
  )} signs - then you'll both get your Island Pass.</p>
${
  pay
    ? `<p style="margin:0 0 12px 0;">Entry fee${d.event.entry_fee ? `: <b>${escapeHtml(d.event.entry_fee)}</b>` : ""}. Use <b>${escapeHtml(
        d.teamId
      )}</b> as your reference (paying separately? add your name, e.g. ${escapeHtml(`${d.teamId} ${d.booker.first_name.trim()}`)}).</p>${
        d.event.bank_details
          ? `<div style="padding:12px;border:1px solid #D7DFEC;border-radius:8px;background:#FAFBFD;font-size:13px;white-space:pre-line;">${escapeHtml(
              d.event.bank_details
            )}\nReference: ${escapeHtml(d.teamId)}</div>`
          : ""
      }`
    : ""
}`;
  const text = [
    `Hi ${d.booker.first_name.trim()},`,
    "",
    `${d.teamName} has a spot booked for ${d.event.name}. Your Team ID is ${d.teamId}.`,
    `We've emailed ${partner} a link to sign. Your spot is confirmed as soon as ${partner} signs.`,
    d.event.entry_fee ? `Entry fee: ${d.event.entry_fee} (reference ${d.teamId})` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const r = await sendViaResend({
    from: fromAddress(d.event),
    to: [d.booker.email],
    subject: `Spot booked: ${d.teamName} (${d.teamId}) - waiting for ${partner} to sign`,
    html: frame(d.event, "Spot booked!", `Waiting for ${partner} to sign`, body, d.teamId),
    text,
  });
  return r.ok;
}
