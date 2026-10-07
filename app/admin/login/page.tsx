import AdminLoginForm from "@/components/login/AdminLoginForm";
import { getActiveEvent } from "@/lib/activeEvent";
import { brandFor } from "@/lib/events";

export const dynamic = "force-dynamic";

// The admin login wears the current event's branding, like the judge login.
export default async function AdminLoginPage() {
  const event = await getActiveEvent().catch(() => null);
  const brand = brandFor(event);
  return (
    <AdminLoginForm
      brand={{
        name: brand.title,
        theme: event?.theme ?? "fof",
        logo: brand.logo,
        logoRound: brand.logoRound,
        partners: brand.partners,
      }}
    />
  );
}
