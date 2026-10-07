import LoginForm from "@/components/login/LoginForm";
import { getActiveEvent } from "@/lib/activeEvent";
import { brandFor } from "@/lib/events";

export const dynamic = "force-dynamic";

// The login screen wears the current event's branding (Survivor blue
// while Survivor is the active event).
export default async function LoginPage() {
  const event = await getActiveEvent().catch(() => null);
  const brand = brandFor(event);
  return (
    <LoginForm
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
