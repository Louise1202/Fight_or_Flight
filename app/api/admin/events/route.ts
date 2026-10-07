import { NextRequest } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { EVENT_COLUMNS, EventRow } from "@/lib/events";
import { cleanText, dbFail, EventSummary, fail, isValidDate, json, notAuthorized, readBody } from "../_lib/guard";

export const dynamic = "force-dynamic";

/** 'Survivor', '2026-11-07' -> 'survivor-2026-11-07' */
function eventSlug(name: string, date: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `${base || "event"}-${date}`;
}

// Every event, newest first, with how many teams each has.
export async function GET() {
  if (!isAdminSession()) return notAuthorized();
  const admin = createAdminClient();

  const [{ data: events, error }, { data: settings }] = await Promise.all([
    admin.from("events").select(EVENT_COLUMNS).order("event_date", { ascending: false }),
    admin.from("app_settings").select("active_event_id").eq("id", 1).maybeSingle(),
  ]);
  if (error) return dbFail(error, "Couldn't load the events.");

  const withCounts: EventSummary[] = await Promise.all(
    ((events ?? []) as EventRow[]).map(async (e) => {
      const { count } = await admin
        .from("teams")
        .select("id", { count: "exact", head: true })
        .eq("event_id", e.id)
        .neq("status", "withdrawn");
      return { ...e, teamCount: count ?? 0 };
    })
  );

  return json({ events: withCounts, activeEventId: settings?.active_event_id ?? null });
}

// Creates a new event. It starts in 'setup', registration closed, with
// no teams and no heats. Stations can be copied from an earlier event.
export async function POST(req: NextRequest) {
  if (!isAdminSession()) return notAuthorized();
  const body = await readBody(req);
  if (!body) return fail("Please fill in the form and try again.");

  const name = cleanText(body.name, 80);
  if (!name || name.length < 2) return fail("Give the event a name.");
  if (!isValidDate(body.event_date)) return fail("Choose the event date.");
  const eventDate = body.event_date;
  const venue = cleanText(body.venue, 120);
  const theme = body.theme;
  if (theme !== "fof" && theme !== "survivor") return fail("Choose a look for the event.");
  const prefix = typeof body.team_id_prefix === "string" ? body.team_id_prefix.trim().toUpperCase() : "";
  if (!/^[A-Z]{2,4}$/.test(prefix)) return fail("Team ID letters must be 2 to 4 capital letters, e.g. SV.");
  const copyFrom = body.copy_stations_from;
  if (copyFrom != null && copyFrom !== "" && typeof copyFrom !== "string") {
    return fail("Choose which event to copy the stations from.");
  }

  const admin = createAdminClient();
  const id = eventSlug(name, eventDate);

  const [{ data: existing }, { data: samePrefix }] = await Promise.all([
    admin.from("events").select("id").eq("id", id).maybeSingle(),
    admin.from("events").select("name").eq("team_id_prefix", prefix).limit(1),
  ]);
  if (existing) return fail("There is already an event with that name on that date.", 409);
  // Team IDs are unique across ALL events, so two events can't share letters.
  if ((samePrefix ?? []).length > 0) {
    return fail(`The letters ${prefix} are already used by ${samePrefix![0].name}. Choose different letters.`, 409);
  }

  let stationsToCopy: { number: number; name: string; is_run: boolean; detail: string | null }[] = [];
  if (typeof copyFrom === "string" && copyFrom) {
    const { data: src, error: srcErr } = await admin
      .from("stations")
      .select("number, name, is_run, detail")
      .eq("event_id", copyFrom)
      .order("number");
    if (srcErr) return dbFail(srcErr, "Couldn't read the stations to copy.");
    stationsToCopy = (src ?? []) as typeof stationsToCopy;
  }

  const row = {
    id,
    name,
    event_date: eventDate,
    venue,
    theme,
    team_id_prefix: prefix,
    team_id_scheme: "sequential",
    status: "setup",
    registration_open: false,
    locked: false,
  };
  const { data: created, error } = await admin.from("events").insert(row).select(EVENT_COLUMNS).single();
  if (error || !created) return dbFail(error, "Couldn't create the event.");

  if (stationsToCopy.length > 0) {
    const { error: stErr } = await admin.from("stations").insert(
      stationsToCopy.map((s) => ({
        event_id: id,
        number: s.number,
        name: s.name,
        is_run: !!s.is_run,
        detail: s.detail ?? null,
      }))
    );
    if (stErr) {
      return json(
        {
          event: { ...(created as unknown as EventRow), teamCount: 0 },
          warning: "The event was created, but its stations couldn't be copied. Add them in the Course tab.",
        },
        201
      );
    }
  }

  return json({ event: { ...(created as unknown as EventRow), teamCount: 0 }, stationsCopied: stationsToCopy.length }, 201);
}
