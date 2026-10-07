import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEventById } from "@/lib/activeEvent";
import { TEAM_TYPES } from "@/lib/events";
import { callerKey, allowRequest } from "@/lib/rateLimit";
import { usernameToEmail } from "@/lib/username";
import { passToken } from "@/lib/islandPass";
import { sendRegisteredEmail } from "@/lib/registeredEmail";
import { sendPartnerInvite, sendSpotBooked } from "@/lib/partnerEmail";
import { signToken } from "@/lib/partnerLink";
import { sendAdminAlert } from "@/lib/adminAlerts";
import { emailConfigured } from "@/lib/resultsEmail";
import { inBackground } from "@/lib/background";
import { isObject, validateBasic, validateSigned, type BasicMember, type SignedAnswers } from "@/lib/registerMember";
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  cleanTeamName,
  isReservedTeamName,
  teamNameKey,
} from "@/components/register/rules";

// Public team self-registration. Everything is checked here by hand
// before anything is written; the database function register_team()
// then creates the team, both athletes and their answers in one
// transaction. Nothing personal is ever logged or echoed in an error.
//
// partner_signs_later: athlete 1 gives only athlete 2's name, phone and
// email. The spot is booked; athlete 2 gets an email link to sign, and
// the team is confirmed when they do (app/api/register/sign).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1.5 * 1024 * 1024;
const GENERIC_400 = "Some details are missing or not valid. Please check the form and try again.";
const GENERIC_500 = "Something went wrong saving your registration. Please try again.";
const CLOSED = "Registration for this event is closed. Contact the organisers.";

function bad(error: string, field?: string, status = 400) {
  return NextResponse.json(field ? { error, field } : { error }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

type DbMember = BasicMember & (Partial<SignedAnswers> & { pending?: true });

// The pass picture and the emails can take a few seconds.
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  // 1. Size: signatures make the body large, but never this large.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return bad("That form is too large to send.", undefined, 413);
  let text: string;
  try {
    text = await req.text();
  } catch {
    return bad(GENERIC_400);
  }
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return bad("That form is too large to send.", undefined, 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return bad(GENERIC_400);
  }
  if (!isObject(body)) return bad(GENERIC_400);

  // 2. Honeypot: real people never see or fill this field.
  if (typeof body.website === "string" && body.website.trim() !== "") return bad(GENERIC_400);

  // 3. Validate everything.
  const eventId = body.eventId;
  if (typeof eventId !== "string" || !/^[a-z0-9-]{1,64}$/i.test(eventId)) return bad(GENERIC_400);

  const type = TEAM_TYPES.find((t) => t.division === body.division);
  if (!type) return bad("Choose your team type.", "division");

  const teamName = cleanTeamName(body.team_name);
  if (teamName === null) return bad("Team names can be at most 40 characters, without < or >.", "team_name");
  if (teamName && isReservedTeamName(teamName)) {
    return bad("Names like “Team SV001” are kept for teams without a name. Try another name.", "team_name");
  }

  const password = body.password;
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return bad(`The team password must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`, "password");
  }

  const partnerLater = body.partner_signs_later === true;
  if (!Array.isArray(body.members) || body.members.length !== 2) return bad(GENERIC_400);
  const acceptedAt = new Date().toISOString();
  const members: DbMember[] = [];
  for (const position of [1, 2] as const) {
    const raw = body.members[position - 1];
    const basic = validateBasic(raw, position, type.genders[position - 1]);
    if (typeof basic === "string") return bad(basic, `member${position}`);
    if (position === 2 && partnerLater) {
      members.push({ ...basic, pending: true });
      continue;
    }
    const signed = validateSigned(raw, position, acceptedAt);
    if (typeof signed === "string") return bad(signed, `member${position}`);
    members.push({ ...basic, ...signed });
  }
  if (members[0].email === members[1].email) {
    return bad("Each athlete needs their own email address.", "member2");
  }

  // 4. Rate limit (after validation, so fixing a typo doesn't use up a try).
  // 30 per hour per network: generous enough for a gym's shared Wi-Fi,
  // still stops a script from flooding the sign-up list.
  if (!(await allowRequest(callerKey(req, "register"), 30, 60 * 60))) {
    return bad("Too many sign-ups from this device. Try again later.", undefined, 429);
  }

  const admin = createAdminClient();

  // 5. Event must exist and be open.
  const event = await getEventById(eventId, admin);
  if (!event) return bad(GENERIC_400, undefined, 404);
  if (!event.registration_open || event.locked || event.team_id_scheme !== "sequential") {
    return bad(CLOSED, undefined, 409);
  }

  // 6. Friendly early check for a taken name (the unique index is the real guard).
  if (teamName) {
    const { data: taken } = await admin
      .from("teams")
      .select("team_name")
      .eq("event_id", event.id)
      .neq("status", "withdrawn")
      .ilike("team_name", teamName.replace(/[\\%_]/g, (c) => `\\${c}`));
    if ((taken ?? []).some((t) => teamNameKey(t.team_name ?? "") === teamNameKey(teamName))) {
      return bad("That team name is already taken.", "team_name", 409);
    }
  }

  // 7. Create the team, both athletes and their answers in one go.
  const { data: teamId, error } = await admin.rpc("register_team", {
    p_event_id: event.id,
    p_team: { team_name: teamName, division: type.division },
    p_members: members,
  });

  if (error || typeof teamId !== "string") {
    const code = error?.code;
    if (code === "23505" && /team_name|unique_name/i.test(`${error?.message ?? ""} ${error?.details ?? ""}`)) {
      return bad("That team name is already taken.", "team_name", 409);
    }
    if (code === "RT011" || code === "RT012") return bad(CLOSED, undefined, 409);
    // Error code only - never the request body or database message text.
    console.error("register: register_team failed", code ?? "no-code");
    return bad(GENERIC_500, undefined, 500);
  }

  // 8. Team login so they can follow their race live.
  const username = teamId.toLowerCase();
  let loginCreated = false;
  try {
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: usernameToEmail(username),
      password,
      email_confirm: true,
    });
    if (!authError && created?.user) {
      const { error: viewerError } = await admin
        .from("team_viewers")
        .insert({ id: created.user.id, team_id: teamId });
      if (viewerError) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
        console.error("register: team_viewers insert failed", viewerError.code ?? "no-code");
      } else {
        loginCreated = true;
      }
    } else {
      console.error("register: team login not created", authError?.status ?? "no-status");
    }
  } catch {
    console.error("register: team login not created", "exception");
  }

  // 9. Emails go out after the reply, so the athlete sees their screen at once:
  //    Both signed: "You're registered" with the Island Pass to both.
  //    Partner signs later: the sign link to athlete 2, "Spot booked" to athlete 1.
  //    Then the registration alert to the organisers' own list.
  const finalName = teamName || `Team ${teamId}`;
  const emailed = emailConfigured();
  inBackground(async () => {
    if (partnerLater) {
      const input = { event, teamId, teamName: finalName, booker: members[0], partner: members[1] };
      await Promise.all([sendPartnerInvite(input).catch(() => false), sendSpotBooked(input).catch(() => false)]);
    } else {
      await sendRegisteredEmail({ event, teamId, teamName: finalName, division: type.division, members }).catch(() => false);
    }
    await sendAdminAlert(admin, event, teamId, partnerLater ? "booked" : "confirmed");
  });

  return NextResponse.json(
    {
      ok: true,
      teamId,
      username,
      loginCreated,
      teamName: finalName,
      emailed,
      // Booked only: no Island Pass yet, but athlete 1 can share the link.
      status: partnerLater ? "booked" : "confirmed",
      passToken: partnerLater ? null : passToken(teamId),
      signToken: partnerLater ? signToken(teamId) : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
