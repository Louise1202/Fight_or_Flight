import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEventById } from "@/lib/activeEvent";
import { brandFor, type Division, type EventRow } from "@/lib/events";
import { teamIdFromSignToken } from "@/lib/partnerLink";
import EventHeader, { PartnerLogos, type PublicEvent } from "@/components/register/EventHeader";
import RegistrationForm from "@/components/register/RegistrationForm";

// The second athlete's personal link (emailed to them after athlete 1
// booked the spot): fill in their own details and sign.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Complete your registration",
  robots: { index: false, follow: false },
};

type Props = { searchParams: { t?: string } };

function Message({ title, text, event }: { title: string; text: string; event?: { publicEvent: PublicEvent; theme: EventRow["theme"] } }) {
  const brand = event ? brandFor({ name: event.publicEvent.name, theme: event.theme }) : null;
  return (
    <main
      data-brand={event?.theme}
      className="flex min-h-screen flex-col items-center justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8"
    >
      <div className="w-full max-w-md">
        {event && brand && <EventHeader event={event.publicEvent} brand={brand} />}
        <div className="mt-10 rounded-lg border border-fofRule bg-fofPanel p-6 text-center">
          <h2 className="font-display text-2xl tracking-wide text-fofPaper">{title}</h2>
          <p className="mt-2 text-fofGunmetal">{text}</p>
        </div>
        {brand && <PartnerLogos brand={brand} />}
      </div>
    </main>
  );
}

export default async function PartnerSignPage({ searchParams }: Props) {
  const token = typeof searchParams.t === "string" ? searchParams.t : null;
  const teamId = teamIdFromSignToken(token);
  if (!token || !teamId) {
    return <Message title="This link isn't valid" text="Ask your partner to send the link again, or contact the organisers." />;
  }

  const admin = createAdminClient();
  const { data: team } = await admin
    .from("teams")
    .select("id, event_id, team_name, division, status")
    .eq("id", teamId)
    .maybeSingle();
  const event = team ? await getEventById(team.event_id, admin) : null;
  if (!team || !event) {
    return <Message title="This link isn't valid" text="Ask your partner to send the link again, or contact the organisers." />;
  }

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
  const ev = { publicEvent, theme: event.theme };

  if (event.locked) return <Message event={ev} title="This event is closed" text="Contact the organisers if you have questions." />;
  if (team.status === "withdrawn") {
    return <Message event={ev} title="This team has been withdrawn" text="Contact the organisers if you think this is a mistake." />;
  }

  const { data: members } = await admin
    .from("team_members")
    .select("position, first_name, surname, phone, email, signed_at")
    .eq("team_id", teamId)
    .order("position", { ascending: true });
  const booker = (members ?? []).find((m) => m.position === 1);
  const me = (members ?? []).find((m) => m.position === 2);
  if (!me) return <Message event={ev} title="This link isn't valid" text="Contact the organisers." />;
  if (me.signed_at) {
    return (
      <Message
        event={ev}
        title="You've already signed"
        text={`${team.team_name ?? `Team ${teamId}`} (${teamId}) is registered. Check your email for your Island Pass.`}
      />
    );
  }

  const brand = brandFor(event);
  return (
    <main
      data-brand={event.theme}
      className="min-h-screen px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-6"
    >
      <div className="mx-auto w-full max-w-lg">
        <RegistrationForm
          event={publicEvent}
          brand={brand}
          partner={{
            token,
            teamId,
            teamName: team.team_name ?? `Team ${teamId}`,
            division: team.division as Division,
            bookerName: booker ? `${booker.first_name} ${booker.surname}` : "Your partner",
            first_name: me.first_name,
            surname: me.surname,
            phone: me.phone,
            email: me.email,
          }}
        />
        <PartnerLogos brand={brand} />
      </div>
    </main>
  );
}
