import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent, getEventById } from "@/lib/activeEvent";
import { EventRow } from "@/lib/events";
import LeaderboardBoard from "@/components/LeaderboardBoard";
import { isPlausibleEventId, loadEventData, toPublicEvent, toPublicStandings } from "@/components/results/data";

export const dynamic = "force-dynamic";

type Props = { searchParams: { eventId?: string | string[]; division?: string | string[] } };

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

async function resolveEvent(eventId: string | undefined): Promise<EventRow | null> {
  const admin = createAdminClient();
  if (eventId == null) return getActiveEvent(admin);
  if (!isPlausibleEventId(eventId)) return null;
  return getEventById(eventId, admin);
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  try {
    const event = await resolveEvent(one(searchParams.eventId));
    return { title: event ? `${event.name} - Live leaderboard` : "Live leaderboard" };
  } catch {
    return { title: "Live leaderboard" };
  }
}

// Public spectator screen (projector + phones). Server-renders the first
// view, then LeaderboardBoard polls /api/leaderboard every 5 seconds.
export default async function LeaderboardPage({ searchParams }: Props) {
  const event = await resolveEvent(one(searchParams.eventId));
  if (!event) notFound();

  const admin = createAdminClient();
  const { standings } = await loadEventData(event, admin);

  return (
    <LeaderboardBoard
      event={toPublicEvent(event)}
      initialStandings={toPublicStandings(standings)}
      initialGeneratedAt={new Date().toISOString()}
      initialDivision={one(searchParams.division) ?? null}
    />
  );
}
