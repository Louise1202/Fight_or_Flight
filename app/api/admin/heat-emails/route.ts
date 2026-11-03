import { NextRequest, NextResponse } from "next/server";
import { cleanEmail } from "@/components/register/rules";
import { emailConfigured, fromAddress, sendViaResend } from "@/lib/resultsEmail";
import { loadHeatEmailTeams, renderHeatEmail, sendHeatEmail } from "@/lib/heatEmail";
import { adminContext, fail, json, lockedFail, readBody } from "../_lib/guard";

// Heat emails for the ACTIVE event (lib/heatEmail.ts).
//   GET                    -> per team: emailed heat/time, whether it changed since
//   GET ?preview=<teamId>  -> the email as a web page
//   POST { test: "me@x" }  -> a sample (first team with a heat) to that address
//   POST { mode: "unsent" } -> every team not emailed yet, or whose heat changed
//   POST { teamId }        -> one team (again)
// Only teams in a heat that hasn't started. Nothing is ever changed except
// the heat_emails record of what was sent.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const GAP_MS = 600; // Resend allows about 2 requests a second
const BUDGET_MS = 45_000;

type Row = { team_id: string; wave: number; scheduled_start: string; status: string; sent_at: string };

async function sentRows(admin: Parameters<typeof loadHeatEmailTeams>[0], ids: string[]): Promise<Map<string, Row>> {
  if (ids.length === 0) return new Map();
  const { data } = await admin.from("heat_emails").select("team_id, wave, scheduled_start, status, sent_at").in("team_id", ids);
  return new Map(((data ?? []) as Row[]).map((r) => [r.team_id, r]));
}

function changed(row: Row | undefined, wave: number, start: string): boolean {
  return !!row && row.status === "sent" && (row.wave !== wave || new Date(row.scheduled_start).getTime() !== new Date(start).getTime());
}

export async function GET(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;

  const previewId = req.nextUrl.searchParams.get("preview");
  if (previewId) {
    const [team] = await loadHeatEmailTeams(admin, event, [previewId]);
    if (!team) return fail("That team isn't in a heat that's still to come.", 404);
    return new NextResponse(renderHeatEmail(event, team).html, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const teams = await loadHeatEmailTeams(admin, event);
  const rows = await sentRows(admin, teams.map((t) => t.id));
  const status = teams.map((t) => {
    const r = rows.get(t.id);
    return {
      teamId: t.id,
      wave: t.wave,
      state: !r ? "not_sent" : r.status !== "sent" ? "failed" : changed(r, t.wave, t.scheduled_start) ? "changed" : "sent",
      sentAt: r?.sent_at ?? null,
    };
  });
  return json({ ok: true, configured: emailConfigured(), status });
}

export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();
  if (!emailConfigured()) return fail("Email sending isn't set up.", 503);

  const body = await readBody(req);

  // A sample to the admin.
  if (body && "test" in body) {
    const to = cleanEmail(body.test);
    if (!to) return fail("Enter a valid email address for the test.");
    const [team] = await loadHeatEmailTeams(admin, event);
    if (!team) return fail("No team is in a heat yet.", 409);
    const msg = renderHeatEmail(event, team, { test: true });
    const r = await sendViaResend({ from: fromAddress(event), to: [to], subject: msg.subject, html: msg.html, text: msg.text });
    if (!r.ok) return fail("The test email couldn't be sent.", 502);
    return json({ ok: true, sample: team.id });
  }

  const one = typeof body?.teamId === "string" ? body.teamId : null;
  if (!one && body?.mode !== "unsent") return fail("Choose who to send to.");

  const teams = await loadHeatEmailTeams(admin, event, one ? [one] : undefined);
  if (one && teams.length === 0) return fail("That team isn't in a heat that's still to come.", 404);
  const rows = await sentRows(admin, teams.map((t) => t.id));
  const queue = one
    ? teams
    : teams.filter((t) => {
        const r = rows.get(t.id);
        return !r || r.status !== "sent" || changed(r, t.wave, t.scheduled_start);
      });

  const started = Date.now();
  let sent = 0;
  let failed = 0;
  let noEmail = 0;
  let remaining = 0;
  for (let i = 0; i < queue.length; i++) {
    if (Date.now() - started > BUDGET_MS) {
      remaining = queue.length - i;
      break;
    }
    const outcome = await sendHeatEmail(admin, event, queue[i]).catch(() => "failed" as const);
    if (outcome === "sent") sent++;
    else if (outcome === "failed") failed++;
    else noEmail++;
    if (i < queue.length - 1) await new Promise((r) => setTimeout(r, GAP_MS));
  }
  return json({ ok: true, sent, failed, noEmail, remaining });
}
