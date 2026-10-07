import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Always dynamic - this hits the live database on every request and
// must never be statically pre-rendered at build time.
export const dynamic = "force-dynamic";

// Judges' phones call this once their own clock passes the heat's time
// limit. It's safe for any logged-in user: the SERVER decides, from its
// own clock and the event's heat length, whether the limit has really
// passed. Calling early (or twice) does nothing.
//
// The heat's end is recorded as exactly start + heat length (e.g. 60:00),
// not "whenever a phone happened to notice", so every screen and the
// results agree to the second.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not logged in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const eventId = typeof body?.eventId === "string" ? body.eventId : null;
  const waveNumber = Number(body?.waveNumber);
  if (!eventId || !Number.isInteger(waveNumber)) {
    return NextResponse.json({ error: "eventId and waveNumber are required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const [{ data: event }, { data: wave }] = await Promise.all([
    admin.from("events").select("heat_minutes, locked").eq("id", eventId).maybeSingle(),
    admin
      .from("waves")
      .select("actual_start, actual_end")
      .eq("event_id", eventId)
      .eq("wave_number", waveNumber)
      .maybeSingle(),
  ]);
  if (!event || !wave || event.locked || !wave.actual_start || wave.actual_end) {
    return NextResponse.json({ ok: true, closed: false });
  }

  const limitAt = new Date(wave.actual_start).getTime() + event.heat_minutes * 60 * 1000;
  if (Date.now() < limitAt) return NextResponse.json({ ok: true, closed: false });

  const { data, error } = await admin
    .from("waves")
    // +1 ms: the start time is stored to the microsecond but JavaScript
    // only keeps milliseconds, so without it the end could land a hair
    // under the limit and a stopped team's clock would read 59:59.
    .update({ actual_end: new Date(limitAt + 1).toISOString(), end_reason: "time_limit" })
    .eq("event_id", eventId)
    .eq("wave_number", waveNumber)
    .is("actual_end", null)
    .select("wave_number")
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Couldn't close the heat" }, { status: 500 });
  return NextResponse.json({ ok: true, closed: !!data });
}
