import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEventById } from "@/lib/activeEvent";
import EventHeader from "@/components/results/EventHeader";
import ResultsBoard from "@/components/results/ResultsBoard";
import BuiltBy from "@/components/BuiltBy";
import { isPlausibleEventId, loadEventData, toPublicEvent, toPublicStandings } from "@/components/results/data";

export const dynamic = "force-dynamic";

type Props = { params: { eventId: string } };

async function load(eventId: string) {
  let id = eventId;
  try {
    id = decodeURIComponent(eventId);
  } catch {
    return null;
  }
  if (!isPlausibleEventId(id)) return null;
  return getEventById(id, createAdminClient());
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await load(params.eventId).catch(() => null);
  return { title: event ? `${event.name} - Results` : "Results" };
}

// Public final results of one event. Server-rendered once; a finished
// event never changes (it is locked in the database), so no polling.
export default async function EventResultsPage({ params }: Props) {
  const event = await load(params.eventId);
  if (!event) notFound();
  const publicEvent = toPublicEvent(event);

  if (event.status !== "finished") {
    return (
      <main data-brand={event.theme} className="ground min-h-screen bg-fofBlack px-4 py-8 text-fofPaper">
        <EventHeader event={publicEvent} subtitle="Results" />
        <div className="mx-auto max-w-xl text-center">
          <p className="text-lg text-fofGunmetal">Results will be final once the event is finished.</p>
          <Link
            href={`/leaderboard?eventId=${encodeURIComponent(event.id)}`}
            className="mt-4 inline-block rounded border border-fofRed px-5 py-3 font-display text-fofRed"
          >
            Live leaderboard
          </Link>
        </div>
      </main>
    );
  }

  const { standings } = await loadEventData(event, createAdminClient());

  return (
    <main data-brand={event.theme} className="ground min-h-screen bg-fofBlack px-4 py-8 text-fofPaper lg:px-10">
      <EventHeader event={publicEvent} subtitle="Final results" />
      <ResultsBoard standings={toPublicStandings(standings)} />
      <p className="mt-10 text-center text-sm">
        <Link href="/results" className="text-fofGunmetal underline">
          All results
        </Link>
      </p>
      <BuiltBy className="mt-6" />
    </main>
  );
}
