import { NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent } from "@/lib/activeEvent";
import { judgeNamesForTeams, loadEventData } from "@/components/results/data";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  try {
    const event = await getActiveEvent(admin);
    const { teams, waves, standings } = await loadEventData(event, admin);
    const { byTeam } = await judgeNamesForTeams(admin, teams.map((t) => t.id));

    const enriched = standings.map((s) => ({ ...s, judgeNames: byTeam.get(s.team.id) ?? [] }));
    const counts = {
      finished: enriched.filter((s) => s.status === "finished").length,
      inProgress: enriched.filter((s) => s.status === "in_progress").length,
      stopped: enriched.filter((s) => s.status === "stopped").length,
      notStarted: enriched.filter((s) => s.status === "not_started").length,
      total: enriched.length,
    };

    return NextResponse.json({
      event: { id: event.id, name: event.name, theme: event.theme, status: event.status, heat_minutes: event.heat_minutes },
      standings: enriched,
      counts,
      waves,
      generatedAt: new Date().toISOString(),
    });
  } catch {
    // Not silently empty (that once made the monitor claim "no teams have
    // started" mid-race) - a clear error the admin can see.
    return NextResponse.json(
      { error: "The database didn't answer - live status will retry automatically." },
      { status: 500 }
    );
  }
}
