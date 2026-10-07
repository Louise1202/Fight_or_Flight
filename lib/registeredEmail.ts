// SERVER-ONLY. "You're registered" email, sent to both athletes straight
// after sign-up, with the Island Pass attached. Never makes the sign-up
// itself fail: if sending isn't set up or fails, the team is still
// registered and sees its Team ID on screen.
import { brandFor, EventRow, formatEventDate } from "@/lib/events";
import { emailConfigured, escapeHtml, fromAddress, sendViaResend } from "@/lib/resultsEmail";
import { passToken, renderIslandPass } from "@/lib/islandPass";

export type RegisteredEmailInput = {
  event: EventRow;
  teamId: string;
  teamName: string;
  division: string | null;
  members: { first_name: string; surname: string; email: string }[];
};

function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || "https://race.betterdesk.app").replace(/\/+$/, "");
}

export function passUrl(teamId: string, download = false): string {
  return `${baseUrl()}/api/register/pass?t=${encodeURIComponent(passToken(teamId))}${download ? "&download=1" : ""}`;
}

export async function sendRegisteredEmail(d: RegisteredEmailInput): Promise<boolean> {
  if (!emailConfigured()) return false;
  const to = [...new Set(d.members.map((m) => m.email.trim().toLowerCase()).filter(Boolean))];
  if (to.length === 0) return false;

  const firstNames = d.members.map((m) => m.first_name.trim()).filter(Boolean);
  const hello = firstNames.length === 2 ? `${firstNames[0]} and ${firstNames[1]}` : firstNames[0] ?? "there";
  const date = formatEventDate(d.event.event_date);
  const where = [d.event.venue, d.event.registration_time ? `check-in from ${d.event.registration_time}` : null]
    .filter(Boolean)
    .join(" - ");
  const logo = `${baseUrl()}${brandFor(d.event).logo}`;
  const dv = `${baseUrl()}/brand/datavera-light.png`;
  const box = `${baseUrl()}/partners/the-box.png`;
  const m2m = `${baseUrl()}/partners/mission-to-move.png`;
  const pay = d.event.entry_fee || d.event.bank_details;

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#EEF2F7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F7;padding:20px 0;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#111827;">
<tr><td align="center" style="background:#050B18;padding:26px 20px;">
<img src="${logo}" width="96" height="96" alt="${escapeHtml(d.event.name)}" style="border-radius:48px;display:block;">
<div style="font-size:24px;font-weight:bold;color:#ffffff;margin-top:16px;">Congratulations!</div>
<div style="font-size:18px;font-weight:bold;color:#2E9BFF;margin-top:4px;">You're on the island</div>
</td></tr>
<tr><td style="padding:22px 24px 6px 24px;font-size:15px;line-height:1.55;">
<p style="margin:0 0 12px 0;">Hi ${escapeHtml(hello)},</p>
<p style="margin:0 0 12px 0;"><b>${escapeHtml(d.teamName)}</b> is registered for ${escapeHtml(d.event.name)}. We're so excited to see you at ${escapeHtml(
    d.event.venue ?? "the event"
  )} on ${escapeHtml(date)}${d.event.registration_time ? ` - check-in from ${escapeHtml(d.event.registration_time)}` : ""}.</p>
</td></tr>
<tr><td align="center" style="padding:6px 24px 10px 24px;">
<div style="border:2px dashed #2E9BFF;border-radius:12px;padding:16px;background:#F3F8FF;">
<div style="font-size:12px;letter-spacing:2px;color:#5B6680;">YOUR TEAM ID</div>
<div style="font-size:38px;font-weight:bold;letter-spacing:2px;color:#0B1220;font-family:Consolas,Menlo,monospace;">${escapeHtml(d.teamId)}</div>
<div style="font-size:13px;color:#5B6680;margin-top:4px;">It stays the same, even when heats change. Your Island Pass is attached.</div>
</div>
</td></tr>
<tr><td style="padding:10px 24px;font-size:14px;line-height:1.55;">
<div style="font-size:12px;font-weight:bold;letter-spacing:1px;color:#5B6680;margin-bottom:6px;">WHAT HAPPENS NEXT</div>
<ol style="margin:0;padding-left:18px;">
${pay ? `<li style="margin-bottom:4px;"><b>Pay your entry fee</b>${d.event.entry_fee ? ` (${escapeHtml(d.event.entry_fee)})` : ""} - use <b>${escapeHtml(d.teamId)}</b> as your reference. Paying separately? Use <b>${escapeHtml(d.teamId)}</b> and your name, e.g. ${escapeHtml(`${d.teamId} ${firstNames[0] ?? ""}`.trim())}.</li>` : ""}
<li style="margin-bottom:4px;"><b>Your heat</b> - we'll email you your heat and start time.</li>
<li style="margin-bottom:4px;"><b>Race day</b> - ${escapeHtml(where || date)}. Show your Island Pass.</li>
</ol>
${
  d.event.bank_details
    ? `<div style="margin-top:12px;padding:12px;border:1px solid #D7DFEC;border-radius:8px;background:#FAFBFD;font-size:13px;white-space:pre-line;">${escapeHtml(
        d.event.bank_details
      )}\nReference: ${escapeHtml(d.teamId)}</div>`
    : ""
}
</td></tr>
<tr><td align="center" style="padding:8px 24px 22px 24px;">
<a href="${passUrl(d.teamId, true)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#2E9BFF;color:#ffffff;font-weight:bold;text-decoration:none;font-size:15px;">Save my Island Pass</a>
</td></tr>
<tr><td align="center" style="background:#F4F6FA;padding:16px 20px;font-size:11px;color:#5B6680;line-height:1.5;">
<img src="${box}" height="30" alt="The Box" style="height:30px;margin:0 8px;"><img src="${m2m}" height="30" alt="Mission To Move" style="height:30px;margin:0 8px;">
<div style="margin-top:8px;">You're getting this because you registered for ${escapeHtml(d.event.name)} (Team ${escapeHtml(d.teamId)}).</div>
<img src="${dv}" height="20" alt="by Datavera Analytics" style="height:20px;margin-top:8px;">
</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    `Hi ${hello},`,
    "",
    `Congratulations! ${d.teamName} is registered for ${d.event.name}.`,
    `We're so excited to see you at ${d.event.venue ?? "the event"} on ${date}${d.event.registration_time ? ` - check-in from ${d.event.registration_time}` : ""}.`,
    "",
    `Your Team ID: ${d.teamId} (use it as your payment reference; paying separately? add your name, e.g. ${d.teamId} ${firstNames[0] ?? ""})`,
    d.event.entry_fee ? `Entry fee: ${d.event.entry_fee}` : "",
    d.event.bank_details ? `${d.event.bank_details}\nReference: ${d.teamId}` : "",
    "",
    "We'll email you your heat and start time closer to the day.",
    `Your Island Pass: ${passUrl(d.teamId, true)}`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  // The pass is attached so it's on their phone even without signal on the day.
  let attachments: { filename: string; content: string }[] | undefined;
  try {
    const img = await renderIslandPass({
      event: d.event,
      teamId: d.teamId,
      teamName: d.teamName,
      athletes: d.members.map((m) => `${m.first_name} ${m.surname}`.trim()),
      division: d.division,
    });
    attachments = [{ filename: `Island-Pass-${d.teamId}.png`, content: Buffer.from(await img.arrayBuffer()).toString("base64") }];
  } catch {
    attachments = undefined; // the button link still works
  }

  const r = await sendViaResend({
    from: fromAddress(d.event),
    to,
    subject: `You're on the island! ${d.teamName} is registered for ${d.event.name} (${d.teamId})`,
    // Only promise an attachment that is really there.
    html: attachments ? html : html.replace("Your Island Pass is attached.", "Tap the button below to save your Island Pass."),
    text,
    attachments,
  });
  return r.ok;
}
