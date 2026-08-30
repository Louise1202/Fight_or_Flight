import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getNextAction } from "@/lib/timing";
import { hasWaveStarted, Wave } from "@/lib/waves";
import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

export default async function JudgeHome() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: judge } = await supabase
    .from("judges")
    .select("id, name")
    .eq("id", user.id)
    .maybeSingle();

  if (!judge) redirect("/login?error=no-role");

  const { data: assignments } = await supabase
    .from("judge_team_assignments")
    .select("team_id, teams(id, team_name, athlete_1, athlete_2, wave)")
    .eq("judge_id", judge.id);

  const teamIds = (assignments ?? []).map((a) => a.team_id);

  const [{ data: allScans }, { data: waves }] = await Promise.all([
    teamIds.length
      ? supabase
          .from("scans")
          .select("team_id, station_number, event_type, scanned_at")
          .in("team_id", teamIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("waves").select("wave_number, scheduled_start, actual_start"),
  ]);

  const waveByNumber = new Map<number, Wave>((waves ?? []).map((w) => [w.wave_number, w as Wave]));

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-fofGunmetal">Judging as</p>
          <p className="font-display text-xl">{judge.name}</p>
        </div>
        <LogoutButton />
      </header>

      <h1 className="mb-4 font-display text-lg tracking-wide text-fofRed">
        YOUR TEAMS
      </h1>

      <ul className="space-y-3">
        {(assignments ?? []).map((a: any) => {
          const team = a.teams;
          const teamScans = (allScans ?? []).filter((s) => s.team_id === team.id);
          const next = getNextAction(teamScans);
          const wave = team.wave != null ? waveByNumber.get(team.wave) : undefined;
          const started = hasWaveStarted(wave);
          return (
            <li key={team.id}>
              <Link
                href={`/judge/${team.id}`}
                className="tap-target flex flex-col justify-center rounded-md border border-fofGunmetal px-4 py-3 hover:border-fofRed"
              >
                <span className="font-display">{team.team_name}</span>
                <span className="text-sm text-fofGunmetal">
                  {team.athlete_1}
                  {team.athlete_2 ? ` & ${team.athlete_2}` : ""}
                </span>
                <span className="mt-1 text-sm text-fofRed">
                  {!started
                    ? `Waiting for Heat ${team.wave} to start`
                    : next.isFinished
                    ? "Finished"
                    : `Next: ${next.label}`}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {(!assignments || assignments.length === 0) && (
        <p className="text-fofGunmetal">
          No teams assigned to you yet. Check with the race organizer.
        </p>
      )}
    </main>
  );
}
