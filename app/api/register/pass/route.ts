import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEventById } from "@/lib/activeEvent";
import { renderIslandPass, teamIdFromPassToken } from "@/lib/islandPass";

// The Island Pass picture: /api/register/pass?t=<signed token>[&download=1]
// The token comes from the sign-up response and the "You're registered"
// email; it can't be guessed from a Team ID.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const teamId = teamIdFromPassToken(req.nextUrl.searchParams.get("t"));
  if (!teamId) return NextResponse.json({ error: "This pass link isn't valid." }, { status: 404 });

  const admin = createAdminClient();
  const { data: team } = await admin
    .from("teams")
    .select("id, event_id, team_name, athlete_1, athlete_2, division, status")
    .eq("id", teamId)
    .maybeSingle();
  if (!team || team.status === "withdrawn") {
    return NextResponse.json({ error: "This pass link isn't valid." }, { status: 404 });
  }
  const event = await getEventById(team.event_id, admin);
  if (!event) return NextResponse.json({ error: "This pass link isn't valid." }, { status: 404 });

  const image = await renderIslandPass({
    event,
    teamId: team.id,
    teamName: team.team_name,
    athletes: [team.athlete_1, team.athlete_2].map((n) => (n ?? "").trim()).filter(Boolean),
    division: team.division,
  });

  const filename = `Island-Pass-${team.id}.png`;
  const headers = new Headers(image.headers);
  headers.set(
    "Content-Disposition",
    `${req.nextUrl.searchParams.get("download") ? "attachment" : "inline"}; filename="${filename}"`
  );
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("X-Robots-Tag", "noindex");
  return new Response(image.body, { status: 200, headers });
}
