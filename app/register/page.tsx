import { notFound, redirect } from "next/navigation";
import { getActiveEvent } from "@/lib/activeEvent";
import type { EventRow } from "@/lib/events";

// /register always leads to the sign-up page of the event that is
// currently active.
export const dynamic = "force-dynamic";

export default async function RegisterIndexPage() {
  let event: EventRow;
  try {
    event = await getActiveEvent();
  } catch {
    notFound();
  }
  redirect(`/register/${encodeURIComponent(event.id)}`);
}
