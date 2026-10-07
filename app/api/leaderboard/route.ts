import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getEventById } from "@/lib/activeEvent";
import { isPlausibleEventId, loadEventData, toPublicEvent, toPublicStandings } from "@/components/results/data";

export const dynamic = "force-dynamic";

// Deliberately public - no login. Shown on a projector and on spectators'
// phones. Returns team id, name, the two athletes' names, division, heat,
// position and times - never contact details, medical data or judges.
//
// A short shared cache (s-maxage=3) means a few hundred phones polling
// every 5 seconds cost the database one query set every 3 seconds.
export async function GET(req: NextRequest) {
  const admin = createAdminClient();
  const requested = req.nextUrl.searchParams.get("eventId");

  try {
    let event;
    if (requested != null) {
      if (!isPlausibleEventId(requested)) {
        return NextResponse.json({ error: "Unknown event" }, { status: 404 });
      }
      event = await getEventById(requested, admin);
      if (!event) return NextResponse.json({ error: "Unknown event" }, { status: 404 });
    } else {
      event = await getActiveEvent(admin);
    }

    const { standings } = await loadEventData(event, admin);

    return NextResponse.json(
      {
        event: toPublicEvent(event),
        standings: toPublicStandings(standings),
        generatedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "public, s-maxage=3, stale-while-revalidate=10" } }
    );
  } catch {
    return NextResponse.json(
      { error: "The leaderboard couldn't be loaded right now - it will retry." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
