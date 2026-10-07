import { brandFor, formatEventDate } from "@/lib/events";
import type { PublicEvent } from "./data";

/** Logo, event name, date and venue. Works in server and client components. */
export default function EventHeader({ event, subtitle }: { event: PublicEvent; subtitle: string }) {
  const brand = brandFor(event);
  return (
    <header className="mb-6 text-center lg:mb-8">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={brand.logo}
        alt={brand.title}
        className={`mx-auto mb-3 h-24 w-24 lg:h-32 lg:w-32 ${brand.logoRound ? "logo-round" : "object-contain"}`}
      />
      <h1 className="font-display text-4xl tracking-wide lg:text-6xl">{event.name.toUpperCase()}</h1>
      <p className="mt-1 text-fofGunmetal lg:text-xl">
        {formatEventDate(event.event_date)}
        {event.venue ? ` · ${event.venue}` : ""}
      </p>
      <p className="mt-1 font-display text-xl tracking-wide text-fofRed lg:text-3xl">{subtitle}</p>
    </header>
  );
}
