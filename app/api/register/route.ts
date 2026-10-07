import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEventById } from "@/lib/activeEvent";
import { TEAM_TYPES } from "@/lib/events";
import { callerKey, allowRequest } from "@/lib/rateLimit";
import { usernameToEmail } from "@/lib/username";
import { passToken } from "@/lib/islandPass";
import { sendRegisteredEmail } from "@/lib/registeredEmail";
import {
  CONSENT_SECTIONS,
  FINAL_DECLARATION,
  MEDICAL_ANSWERS,
  MEDICAL_QUESTIONS,
  WORDING_VERSION,
  type MedicalAnswer,
} from "@/lib/legal/survivor";
import {
  DETAILS_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  cleanEmail,
  cleanPersonName,
  cleanRelationship,
  cleanTeamName,
  isReservedTeamName,
  isSignaturePng,
  normalisePhone,
  teamNameKey,
} from "@/components/register/rules";

// Public team self-registration. Everything is checked here by hand
// before anything is written; the database function register_team()
// then creates the team, both athletes and their medical answers in one
// transaction. Nothing personal is ever logged or echoed in an error.
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

type CleanMember = {
  position: 1 | 2;
  first_name: string;
  surname: string;
  gender: "male" | "female";
  phone: string;
  email: string;
  emergency_name: string;
  emergency_phone: string;
  emergency_relationship: string;
  consents: { version: string; accepted: Record<string, true>; accepted_at: string };
  signature_png: string;
  medical: Record<string, MedicalAnswer>;
  medical_details: string;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Returns the cleaned member, or a short reason (never containing the data itself). */
function validateMember(raw: unknown, position: 1 | 2, gender: "male" | "female", acceptedAt: string): CleanMember | string {
  const who = `Athlete ${position}`;
  if (!isObject(raw)) return `${who}: details are missing.`;

  const first_name = cleanPersonName(raw.first_name);
  if (!first_name) return `${who}: check the first name.`;
  const surname = cleanPersonName(raw.surname);
  if (!surname) return `${who}: check the surname.`;
  if (raw.gender !== gender) return `${who}: the gender doesn't match the team type.`;
  const phone = normalisePhone(raw.phone);
  if (!phone) return `${who}: enter a valid South African phone number.`;
  const email = cleanEmail(raw.email);
  if (!email) return `${who}: enter a valid email address.`;
  const emergency_name = cleanPersonName(raw.emergency_name);
  if (!emergency_name) return `${who}: check the emergency contact's name.`;
  const emergency_phone = normalisePhone(raw.emergency_phone);
  if (!emergency_phone) return `${who}: enter a valid emergency contact phone number.`;
  const emergency_relationship = cleanRelationship(raw.emergency_relationship);
  if (emergency_relationship === null) return `${who}: check the emergency contact's relationship.`;

  // Medical: every question answered no / yes / unknown, nothing extra.
  if (!isObject(raw.medical)) return `${who}: answer every medical question.`;
  const medical: Record<string, MedicalAnswer> = {};
  for (const q of MEDICAL_QUESTIONS) {
    const a = raw.medical[q.key];
    if (typeof a !== "string" || !(MEDICAL_ANSWERS as readonly string[]).includes(a)) {
      return `${who}: answer every medical question.`;
    }
    medical[q.key] = a as MedicalAnswer;
  }
  const detailsRaw = raw.medical_details ?? "";
  if (typeof detailsRaw !== "string") return `${who}: check the medical details.`;
  const medical_details = detailsRaw.trim();
  if (medical_details.length > DETAILS_MAX) return `${who}: medical details can be at most ${DETAILS_MAX} characters.`;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(medical_details)) return `${who}: check the medical details.`;
  if (Object.values(medical).includes("yes") && medical_details.length === 0) {
    return `${who}: please add details for the medical questions answered Yes.`;
  }

  // Consents: every section and every declaration item ticked.
  if (!isObject(raw.consents)) return `${who}: every consent and declaration must be ticked.`;
  const accepted: Record<string, true> = {};
  for (const key of [...CONSENT_SECTIONS.map((s) => s.key), ...FINAL_DECLARATION.map((d) => d.key)]) {
    if (raw.consents[key] !== true) return `${who}: every consent and declaration must be ticked.`;
    accepted[key] = true;
  }

  if (!isSignaturePng(raw.signature_png)) return `${who}: please sign again.`;

  return {
    position,
    first_name,
    surname,
    gender,
    phone,
    email,
    emergency_name,
    emergency_phone,
    emergency_relationship,
    consents: { version: WORDING_VERSION, accepted, accepted_at: acceptedAt },
    signature_png: raw.signature_png,
    medical,
    medical_details,
  };
}

// The pass picture and the email can take a few seconds.
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

  if (!Array.isArray(body.members) || body.members.length !== 2) return bad(GENERIC_400);
  const acceptedAt = new Date().toISOString();
  const members: CleanMember[] = [];
  for (const position of [1, 2] as const) {
    const m = validateMember(body.members[position - 1], position, type.genders[position - 1], acceptedAt);
    if (typeof m === "string") return bad(m, `member${position}`);
    members.push(m);
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

  // 7. Create the team, both athletes and their medical answers in one go.
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

  // 9. "You're registered" email with the Island Pass. Never blocks or
  // fails the sign-up: at most ~8 seconds, then the screen shows anyway.
  const finalName = teamName || `Team ${teamId}`;
  let emailed = false;
  try {
    emailed = await Promise.race([
      sendRegisteredEmail({ event, teamId, teamName: finalName, division: type.division, members }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 8000)),
    ]);
  } catch {
    emailed = false;
  }

  return NextResponse.json(
    { ok: true, teamId, username, loginCreated, teamName: finalName, passToken: passToken(teamId), emailed },
    { headers: { "Cache-Control": "no-store" } }
  );
}
