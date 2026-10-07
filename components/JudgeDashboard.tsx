"use client";

import LogoutButton from "./LogoutButton";
import TeamCard from "./TeamCard";
import { Wave } from "@/lib/waves";
import { StationDef } from "@/lib/stations";
import { useSharedTheme } from "@/lib/useSharedTheme";
import { ScanRow } from "@/lib/useTeamScans";
import { EventTheme } from "@/lib/events";

type Team = {
  id: string;
  event_id: string;
  team_name: string;
  athlete_1: string | null;
  athlete_2: string | null;
  start_time: string;
  wave: number | null;
};

export default function JudgeDashboard({
  judgeName,
  judgeId,
  event,
  teams,
  scansByTeam,
  wavesByNumber,
  initialTheme,
  stations,
}: {
  judgeName: string;
  judgeId: string;
  event: { id: string; name: string; theme: EventTheme; heat_minutes: number; dateLabel: string; logo: string; logoRound: boolean };
  teams: Team[];
  scansByTeam: Record<string, ScanRow[]>;
  wavesByNumber: Record<number, Wave>;
  initialTheme: "dark" | "light";
  stations: StationDef[];
}) {
  const theme = useSharedTheme(initialTheme);

  return (
    <main
      data-theme={theme}
      data-brand={event.theme}
      className="ground mx-auto min-h-screen max-w-md bg-fofBlack px-4 py-8 text-fofPaper"
    >
      <header className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <img
            src={event.logo}
            alt=""
            className={`h-12 w-12 ${event.logoRound ? "logo-round" : "rounded-full"}`}
          />
          <div>
            <p className="text-sm text-fofGunmetal">
              {event.name} · {event.dateLabel}
            </p>
            <p className="font-display text-xl">Judging as {judgeName}</p>
          </div>
        </div>
        <LogoutButton />
      </header>

      <h1 className="mb-4 font-display text-lg tracking-wide text-fofRed">YOUR TEAMS</h1>

      <div className="space-y-3">
        {teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            judgeId={judgeId}
            initialScans={scansByTeam[team.id] ?? []}
            initialWave={team.wave != null ? wavesByNumber[team.wave] ?? null : null}
            stations={stations}
            heatMinutes={event.heat_minutes}
          />
        ))}
      </div>

      {teams.length === 0 && (
        <p className="text-fofGunmetal">No teams assigned to you for {event.name} yet. Check with the race organiser.</p>
      )}
    </main>
  );
}
