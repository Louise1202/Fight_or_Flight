import type { Metadata } from "next";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadTeamResult, teamForToken } from "@/lib/teamResult";
import TeamResultView from "@/components/results/TeamResultView";

// Passwordless results page from the results email: /r/<random token>.
// Only the SHA-256 of the token is stored; links expire after 30 days.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your results",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Expired() {
  return (
    <main className="ground flex min-h-screen items-center justify-center bg-fofBlack px-4 text-fofPaper">
      <div className="max-w-sm text-center">
        <p className="font-display text-xl">This link has expired.</p>
        <p className="mt-2 text-sm text-fofGunmetal">Log in with your team login to see your results.</p>
        <Link href="/login" className="tap-target btn-stamped mt-4 inline-flex items-center rounded px-5 font-display">
          Log in
        </Link>
      </div>
    </main>
  );
}

export default async function ResultLinkPage({ params }: { params: { token: string } }) {
  const admin = createAdminClient();
  let teamId: string | null = null;
  try {
    teamId = await teamForToken(params.token, admin);
  } catch {
    teamId = null;
  }
  if (!teamId) return <Expired />;

  let result = null;
  try {
    result = await loadTeamResult(teamId, admin);
  } catch {
    result = null;
  }
  if (!result || result.team.status === "withdrawn") return <Expired />;

  const { data: settings } = await admin.from("app_settings").select("theme").eq("id", 1).maybeSingle();
  const fileName = `${result.event.name}-${result.team.id}`.replace(/[^A-Za-z0-9-]+/g, "-") + ".png";

  return (
    <TeamResultView
      result={result}
      cardUrl={`/r/${encodeURIComponent(params.token)}/card`}
      cardFileName={fileName}
      theme={settings?.theme === "light" ? "light" : "dark"}
    />
  );
}
