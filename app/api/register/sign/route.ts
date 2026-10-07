import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEventById } from "@/lib/activeEvent";
import { callerKey, allowRequest } from "@/lib/rateLimit";
import { passToken } from "@/lib/islandPass";
import { teamIdFromSignToken } from "@/lib/partnerLink";
import { sendRegisteredEmail } from "@/lib/registeredEmail";
import { isObject, validateSigned } from "@/lib/registerMember";
import { sendAdminAlert } from "@/lib/adminAlerts";
import { emailConfigured } from "@/lib/resultsEmail";
import { inBackground } from "@/lib/background";

// The second athlete completes the team's registration from their email
// link: their own details, medical answers, consents and signature. When
// everyone has signed the team is confirmed and both get the Island Pass.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BODY_BYTES = 1 * 1024 * 1024;
const GENERIC_400 = "Some details are missing or not valid. Please check the form and try again.";
const LINK_BAD = "This link isn't valid. Ask your partner to send it again, or contact the organisers.";

function bad(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return bad("That form is too large to send.", 413);
  let body: unknown;
  try {
    const text = await req.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return bad("That form is too large to send.", 413);
    body = JSON.parse(text);
  } catch {
    return bad(GENERIC_400);
  }
  if (!isObject(body)) return bad(GENERIC_400);

  const teamId = teamIdFromSignToken(typeof body.t === "string" ? body.t : null);
  if (!teamId) return bad(LINK_BAD, 404);

  const signed = validateSigned(body.member, 2, new Date().toISOString());
  if (typeof signed === "string") return bad(signed);

  if (!(await allowRequest(callerKey(req, "register-sign"), 30, 60 * 60))) {
    return bad("Too many tries from this device. Try again later.", 429);
  }

  const admin = createAdminClient();
  const { data: team } = await admin
    .from("teams")
    .select("id, event_id, team_name, division, status")
    .eq("id", teamId)
    .maybeSingle();
  if (!team) return bad(LINK_BAD, 404);

  const { data: status, error } = await admin.rpc("sign_team_member", {
    p_team_id: teamId,
    p_position: 2,
    p_member: signed,
  });
  if (error || typeof status !== "string") {
    const code = error?.code;
    if (code === "RT015") return bad("You've already signed - your team's registration is complete.", 409, { already: true });
    if (code === "RT014") return bad("This team has been withdrawn. Contact the organisers.", 409);
    if (code === "RT001") return bad("This event is closed.", 409);
    if (code === "RT013") return bad(LINK_BAD, 404);
    console.error("register/sign: sign_team_member failed", code ?? "no-code");
    return bad("Something went wrong saving your registration. Please try again.", 500);
  }

  const { data: members } = await admin
    .from("team_members")
    .select("position, first_name, surname, email")
    .eq("team_id", teamId)
    .order("position", { ascending: true });
  const list = members ?? [];
  const teamName = team.team_name ?? `Team ${teamId}`;

  // Confirmed: the "You're registered" email with the Island Pass to both,
  // then the organisers' alert - both after the reply, so nobody waits.
  let emailed = false;
  if (status === "confirmed") {
    const event = await getEventById(team.event_id, admin);
    if (event) {
      emailed = emailConfigured();
      inBackground(async () => {
        await sendRegisteredEmail({ event, teamId, teamName, division: team.division, members: list }).catch(() => false);
        await sendAdminAlert(admin, event, teamId, "confirmed");
      });
    }
  }

  return NextResponse.json(
    {
      ok: true,
      status,
      teamId,
      teamName,
      division: team.division,
      username: teamId.toLowerCase(),
      athletes: list.map((m) => `${m.first_name} ${m.surname}`.trim()),
      passToken: status === "confirmed" ? passToken(teamId) : null,
      emailed,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
