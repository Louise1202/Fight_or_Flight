import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import BigScreen from "@/components/screen/BigScreen";
import { getActiveEvent, getEventById } from "@/lib/activeEvent";
import { brandFor } from "@/lib/events";
import {
  isPlausibleEventId,
  loadEventData,
  stationRecords,
  toPublicEvent,
  toPublicStandings,
  toPublicWaves,
} from "@/components/results/data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Big screen" };

// The venue TV / projector. Public (it shows only what the leaderboard
// shows). /screen = the active event; /screen?eventId=... for another one.
export default async function ScreenPage({ searchParams }: { searchParams: { eventId?: string } }) {
  const requested = searchParams.eventId;
  const event = requested
    ? isPlausibleEventId(requested)
      ? await getEventById(requested)
      : null
    : await getActiveEvent().catch(() => null);
  if (!event) notFound();

  const data = await loadEventData(event);
  const brand = brandFor(event);

  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const followUrl = `${proto}://${host}/leaderboard`;

  return (
    <BigScreen
      initial={{
        event: toPublicEvent(event),
        standings: toPublicStandings(data.standings),
        waves: toPublicWaves(data.waves),
        records: stationRecords(data),
      }}
      brand={{ logo: brand.logo, logoRound: brand.logoRound, partners: brand.partners }}
      followUrl={followUrl}
    />
  );
}
