import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { brandFor, formatEventDate, EventRow } from "@/lib/events";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Results" };

type ListedEvent = Pick<EventRow, "id" | "name" | "event_date" | "venue" | "theme">;

// Public list of finished events, newest first.
export default async function ResultsIndexPage() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("events")
    .select("id, name, event_date, venue, theme")
    .eq("status", "finished")
    .order("event_date", { ascending: false });
  const events = (data ?? []) as ListedEvent[];

  return (
    <main className="ground min-h-screen bg-fofBlack px-4 py-8 text-fofPaper">
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-center font-display text-4xl tracking-wide">RESULTS</h1>
        {error ? (
          <p className="text-center text-fofGunmetal">Results couldn&apos;t be loaded right now. Please try again shortly.</p>
        ) : events.length === 0 ? (
          <p className="text-center text-fofGunmetal">No finished events yet.</p>
        ) : (
          <ul className="space-y-3">
            {events.map((e) => {
              const brand = brandFor(e);
              return (
                <li key={e.id} data-brand={e.theme}>
                  <Link
                    href={`/results/${encodeURIComponent(e.id)}`}
                    className="flex items-center gap-4 rounded border border-fofCharcoal bg-fofPanel p-4 text-fofPaper hover:border-fofRed"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={brand.logo}
                      alt=""
                      className={`h-14 w-14 shrink-0 ${brand.logoRound ? "logo-round" : "object-contain"}`}
                    />
                    <span className="min-w-0">
                      <span className="block font-display text-2xl tracking-wide">{e.name}</span>
                      <span className="block text-sm text-fofGunmetal">
                        {formatEventDate(e.event_date)}
                        {e.venue ? ` · ${e.venue}` : ""}
                      </span>
                    </span>
                    <span className="ml-auto font-display text-fofRed">View &rarr;</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-8 text-center text-sm">
          <Link href="/leaderboard" className="text-fofGunmetal underline">
            Live leaderboard
          </Link>
        </p>
      </div>
    </main>
  );
}
