import { NextRequest, NextResponse } from "next/server";
import { cleanEmail } from "@/components/register/rules";
import { emailConfigured, fromAddress, sendViaResend } from "@/lib/resultsEmail";
import { BRIEFING_KEY, loadBriefingTeams, renderBriefing, sendBriefing } from "@/lib/briefingEmail";
import { adminContext, fail, json, lockedFail, readBody } from "../_lib/guard";

// The athlete briefing for the ACTIVE event (lib/briefingEmail.ts).
//   GET                   -> how many teams, how many have it
//   GET ?preview=1        -> the email as a web page (first team)
//   POST { test: "a@b" }  -> a sample to that address
//   POST { mode: "unsent" } -> every team that hasn't had it yet
// Each team gets it once. Nothing is changed except the send record.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const GAP_MS = 600; // Resend allows about 2 requests a second
const BUDGET_MS = 45_000;

export async function GET(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  const teams = await loadBriefingTeams(admin, event);

  if (req.nextUrl.searchParams.get("preview")) {
    const first = teams.find((t) => t.wave != null) ?? teams[0];
    if (!first) return fail("There are no teams yet.", 404);
    return new NextResponse(renderBriefing(event, first).html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const { data } = await admin.from("message_sends").select("team_id, status").eq("message_key", BRIEFING_KEY);
  const sentIds = new Set((data ?? []).filter((r) => r.status === "sent").map((r) => r.team_id as string));
  const sent = teams.filter((t) => sentIds.has(t.id)).length;
  return json({ ok: true, configured: emailConfigured(), teams: teams.length, sent });
}

export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();
  if (!emailConfigured()) return fail("Email sending isn't set up.", 503);

  const body = await readBody(req);
  const teams = await loadBriefingTeams(admin, event);

  if (body && "test" in body) {
    const to = cleanEmail(body.test);
    if (!to) return fail("Enter a valid email address for the test.");
    const first = teams.find((t) => t.wave != null) ?? teams[0];
    if (!first) return fail("There are no teams yet.", 409);
    const msg = renderBriefing(event, first, { test: true });
    const r = await sendViaResend({ from: fromAddress(event), to: [to], subject: msg.subject, html: msg.html, text: msg.text });
    if (!r.ok) return fail("The test email couldn't be sent.", 502);
    return json({ ok: true, sample: first.id });
  }

  if (body?.mode !== "unsent") return fail("Choose who to send to.");

  const { data } = await admin.from("message_sends").select("team_id, status").eq("message_key", BRIEFING_KEY);
  const sentIds = new Set((data ?? []).filter((r) => r.status === "sent").map((r) => r.team_id as string));
  const queue = teams.filter((t) => !sentIds.has(t.id));

  const started = Date.now();
  let sent = 0;
  let failed = 0;
  let remaining = 0;
  for (let i = 0; i < queue.length; i++) {
    if (Date.now() - started > BUDGET_MS) {
      remaining = queue.length - i;
      break;
    }
    const outcome = await sendBriefing(admin, event, queue[i]).catch(() => "failed" as const);
    if (outcome === "sent") sent++;
    else failed++;
    if (i < queue.length - 1) await new Promise((r) => setTimeout(r, GAP_MS));
  }
  return json({ ok: true, sent, failed, remaining });
}
