import type { Brand } from "@/lib/events";
import { formatEventDate } from "@/lib/events";
import BuiltBy from "@/components/BuiltBy";

export type PublicEvent = {
  id: string;
  name: string;
  event_date: string;
  venue: string | null;
  registration_time: string | null;
  team_id_prefix: string;
  entry_fee: string | null;
  bank_details: string | null;
};

export function eventLine(event: PublicEvent): string {
  const parts = [formatEventDate(event.event_date)];
  if (event.venue) parts.push(event.venue);
  if (event.registration_time) parts.push(`Registration ${event.registration_time}`);
  return parts.join(" · ");
}

export default function EventHeader({ event, brand, compact = false }: { event: PublicEvent; brand: Brand; compact?: boolean }) {
  return (
    <header className="text-center">
      <img
        src={brand.logo}
        alt={`${event.name} logo`}
        width={compact ? 88 : 128}
        height={compact ? 88 : 128}
        className={`mx-auto mb-3 ${compact ? "h-[88px] w-[88px]" : "h-32 w-32"} ${brand.logoRound ? "logo-round" : "rounded-full"}`}
      />
      <h1 className="font-marker text-4xl leading-none tracking-wide text-fofRed">{event.name.toUpperCase()}</h1>
      <p className="nums mt-2 text-sm text-fofGunmetal">{eventLine(event)}</p>
    </header>
  );
}

export function PartnerLogos({ brand }: { brand: Brand }) {
  return (
    <>
      {brand.partners.length > 0 && (
        <div className="mt-12 flex flex-wrap items-center justify-center gap-8 opacity-70">
          {brand.partners.map((p) => (
            <img key={p.src} src={p.src} alt={p.alt} className="h-[60px] w-auto" />
          ))}
        </div>
      )}
      <BuiltBy className="mt-6" />
    </>
  );
}
