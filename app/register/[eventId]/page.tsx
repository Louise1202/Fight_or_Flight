import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getEventById } from "@/lib/activeEvent";
import { brandFor, type EventRow } from "@/lib/events";
import EventHeader, { PartnerLogos, type PublicEvent } from "@/components/register/EventHeader";
import RegistrationForm from "@/components/register/RegistrationForm";

export const dynamic = "force-dynamic";

type Props = { params: { eventId: string } };

async function loadEvent(raw: string): Promise<EventRow | null> {
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    return null; // a mangled link - shown as "not found", not an error page
  }
  if (!/^[a-z0-9-]{1,64}$/i.test(id)) return null;
  return getEventById(id);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const event = await loadEvent(params.eventId);
  if (!event) return { title: "Registration" };
  const brand = brandFor(event);
  return {
    title: `${event.name} - Team registration`,
    description: `Sign up your team of two for ${event.name}.`,
    icons: { icon: brand.logo, apple: brand.logo },
  };
}

export default async function RegisterEventPage({ params }: Props) {
  const event = await loadEvent(params.eventId);
  if (!event) notFound();

  const brand = brandFor(event);
  // Only public facts go to the browser.
  const publicEvent: PublicEvent = {
    id: event.id,
    name: event.name,
    event_date: event.event_date,
    venue: event.venue,
    registration_time: event.registration_time,
    team_id_prefix: event.team_id_prefix,
    entry_fee: event.entry_fee,
    bank_details: event.bank_details,
  };

  const open = event.registration_open && !event.locked && event.team_id_scheme === "sequential";

  if (!open) {
    return (
      <main
        data-brand={event.theme}
        className="flex min-h-screen flex-col items-center justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8"
      >
        <div className="w-full max-w-md">
          <EventHeader event={publicEvent} brand={brand} />
          <div className="mt-10 rounded-lg border border-fofRule bg-fofPanel p-6 text-center">
            <h2 className="font-display text-2xl tracking-wide text-fofPaper">Sign-ups are not open</h2>
            <p className="mt-2 text-fofGunmetal">Registration is closed. Contact the organisers.</p>
          </div>
          <PartnerLogos brand={brand} />
        </div>
      </main>
    );
  }

  return (
    <main
      data-brand={event.theme}
      className="min-h-screen px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-6"
    >
      <div className="mx-auto w-full max-w-lg">
        <RegistrationForm event={publicEvent} brand={brand} />
        <PartnerLogos brand={brand} />
      </div>
    </main>
  );
}
