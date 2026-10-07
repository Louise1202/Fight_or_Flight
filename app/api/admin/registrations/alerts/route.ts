import { NextRequest } from "next/server";
import { cleanEmail } from "@/components/register/rules";
import { MAX_ALERT_EMAILS, loadAlertSettings, sendAdminAlert } from "@/lib/adminAlerts";
import { adminContext, dbFail, fail, json, readBody } from "../../_lib/guard";

// Registration alerts for the ACTIVE event: which admin addresses get an
// email when a spot is booked, a team is confirmed or withdrawn.
//   GET   -> current settings
//   PUT   { emails: string[], on_booked, on_confirmed, on_withdrawn }
//   POST  -> sends a test alert to the saved list (using the newest team)
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  return json({ ok: true, settings: await loadAlertSettings(ctx.admin, ctx.event.id) });
}

export async function PUT(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;

  const body = await readBody(req);
  if (!body || !Array.isArray(body.emails)) return fail("Nothing to save.");
  const emails: string[] = [];
  for (const raw of body.emails) {
    const e = cleanEmail(raw);
    if (!e) return fail("One of the email addresses isn't valid.");
    if (!emails.includes(e)) emails.push(e);
  }
  if (emails.length > MAX_ALERT_EMAILS) return fail(`You can add up to ${MAX_ALERT_EMAILS} email addresses.`);
  const flag = (v: unknown) => v !== false;

  const row = {
    event_id: event.id,
    emails,
    on_booked: flag(body.on_booked),
    on_confirmed: flag(body.on_confirmed),
    on_withdrawn: flag(body.on_withdrawn),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("event_alerts").upsert(row, { onConflict: "event_id" });
  if (error) return dbFail(error, "Couldn't save the alert settings.");
  return json({ ok: true, settings: { emails: row.emails, on_booked: row.on_booked, on_confirmed: row.on_confirmed, on_withdrawn: row.on_withdrawn } });
}

export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;

  // The test goes to every address on the saved list.
  await readBody(req);
  const { emails: to } = await loadAlertSettings(admin, event.id);
  if (to.length === 0) return fail("Add at least one email address first.");

  const { data: newest } = await admin
    .from("teams")
    .select("id, status")
    .eq("event_id", event.id)
    .order("registered_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!newest) return fail("There are no teams yet to use for a test email.", 409);

  const kind = newest.status === "withdrawn" ? "withdrawn" : newest.status === "confirmed" ? "confirmed" : "booked";
  const sent = await sendAdminAlert(admin, event, newest.id, kind, { to, test: true });
  if (!sent) return fail("The test email couldn't be sent. Check that email sending is set up.", 502);
  return json({ ok: true, sentTo: to.length });
}
