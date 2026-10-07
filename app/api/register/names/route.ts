import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/fetchAll";
import { isReservedTeamName } from "@/components/register/rules";

// Team names already taken in one event (withdrawn teams don't count),
// for the sign-up form's live "name taken" check. Names only - no ids,
// athletes or anything else.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const eventId = req.nextUrl.searchParams.get("eventId");
  if (!eventId || !/^[a-z0-9-]{1,64}$/i.test(eventId)) {
    return NextResponse.json({ error: "eventId is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: event } = await admin.from("events").select("id").eq("id", eventId).maybeSingle();
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  try {
    const rows = await fetchAll<{ id: string; team_name: string | null }>((from, to) =>
      admin
        .from("teams")
        .select("id, team_name")
        .eq("event_id", eventId)
        .neq("status", "withdrawn")
        .order("id", { ascending: true })
        .range(from, to)
    );
    const seen = new Set<string>();
    const names: string[] = [];
    for (const r of rows) {
      const name = (r.team_name ?? "").replace(/\s+/g, " ").trim();
      const key = name.toLowerCase();
      // "Team SV001" names (teams that left the name blank) are reserved anyway.
      if (!name || seen.has(key) || isReservedTeamName(name)) continue;
      seen.add(key);
      names.push(name);
    }
    names.sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
    return NextResponse.json({ names }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load team names" }, { status: 500 });
  }
}
