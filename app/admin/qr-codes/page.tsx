import { redirect } from "next/navigation";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import QrPrintSheet from "@/components/QrPrintSheet";

export const dynamic = "force-dynamic";

export default async function QrCodesPage() {
  if (!isAdminSession()) redirect("/admin/login");

  const admin = createAdminClient();
  const { data: teams } = await admin
    .from("teams")
    .select("id, team_name")
    .order("id");

  return <QrPrintSheet teams={teams ?? []} />;
}
