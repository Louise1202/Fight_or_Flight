import { redirect } from "next/navigation";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent } from "@/lib/activeEvent";
import { formatEventDate } from "@/lib/events";
import QrPrintSheet from "@/components/QrPrintSheet";

export const dynamic = "force-dynamic";

// One QR code per team of the ACTIVE event (withdrawn teams left out).
export default async function QrCodesPage() {
  if (!isAdminSession()) redirect("/admin/login");

  const admin = createAdminClient();
  const event = await getActiveEvent(admin);
  const { data: teams } = await admin
    .from("teams")
    .select("id, team_name, wave")
    .eq("event_id", event.id)
    .neq("status", "withdrawn")
    .order("id");

  return (
    <div data-brand={event.theme}>
      <QrPrintSheet
        teams={teams ?? []}
        eventTitle={`${event.name} · ${formatEventDate(event.event_date)}`}
      />
    </div>
  );
}
