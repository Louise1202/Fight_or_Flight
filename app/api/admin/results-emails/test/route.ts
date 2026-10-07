import { NextRequest } from "next/server";
import { emailConfigured, isValidEmail, sendTestEmail } from "@/lib/resultsEmail";
import { adminContext, fail, json, readBody, teamInEvent } from "../../_lib/guard";

// "Send a test to me": the heat-results email of one team of the ACTIVE
// event, to one address only, "[TEST]" in the subject. Nothing is recorded
// in result_emails, so the team's own email still goes out as normal.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;

  if (!emailConfigured()) return fail("Email sending isn't connected yet.", 409);
  const body = await readBody(req);
  const teamId = typeof body?.teamId === "string" ? body.teamId : "";
  const to = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!teamId) return fail("Choose a team.");
  if (!isValidEmail(to)) return fail("Type a valid email address.");

  try {
    const team = await teamInEvent(admin, teamId, event.id);
    if (!team) return fail("That team isn't in the active event.", 404);
    const r = await sendTestEmail(admin, event, teamId, to);
    if (r.ok) return json({ ok: true });
    return fail(`The test email couldn't be sent (${r.error}).`, 502);
  } catch {
    console.error("admin/results-emails/test: failed");
    return fail("The test email couldn't be sent.", 500);
  }
}
