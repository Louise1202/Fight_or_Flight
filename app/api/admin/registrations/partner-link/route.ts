import { NextRequest } from "next/server";
import { sendPartnerInvite } from "@/lib/partnerEmail";
import { signUrl } from "@/lib/partnerLink";
import { adminContext, fail, json, lockedFail, readBody, teamInEvent } from "../../_lib/guard";

// Admin: email the second athlete their link to sign again (spot booked,
// not yet confirmed). Also returns the link so the admin can WhatsApp it.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;
  if (event.locked) return lockedFail();

  const body = await readBody(req);
  const teamId = typeof body?.teamId === "string" ? body.teamId : "";
  if (!teamId) return fail("Choose a team.");
  const team = await teamInEvent(admin, teamId, event.id);
  if (!team) return fail("That team isn't in the current event.", 404);
  if (team.status === "withdrawn") return fail("This team has been withdrawn.", 409);

  const { data: members } = await admin
    .from("team_members")
    .select("position, first_name, surname, email, signed_at")
    .eq("team_id", teamId)
    .order("position", { ascending: true });
  const booker = (members ?? []).find((m) => m.position === 1);
  const partner = (members ?? []).find((m) => m.position === 2);
  if (!booker || !partner) return fail("This team has no athlete details on file.", 409);
  if (partner.signed_at) return fail(`${partner.first_name} has already signed.`, 409);

  const sent = await sendPartnerInvite({
    event,
    teamId,
    teamName: team.team_name ?? `Team ${teamId}`,
    booker,
    partner,
  }).catch(() => false);

  return json({ ok: true, sent, link: signUrl(teamId) });
}
