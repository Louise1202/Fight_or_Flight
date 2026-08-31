"use client";

import LogoutButton from "./LogoutButton";
import TeamCard from "./TeamCard";
import { Scan } from "@/lib/timing";
import { Wave } from "@/lib/waves";

type Team = {
  id: string;
  team_name: string;
  athlete_1: string | null;
  athlete_2: string | null;
  start_time: string;
  wave: number | null;
};

export default function JudgeDashboard({
  judgeName,
  judgeId,
  teams,
  scansByTeam,
  wavesByNumber,
}: {
  judgeName: string;
  judgeId: string;
  teams: Team[];
  scansByTeam: Record<string, (Scan & { id: number })[]>;
  wavesByNumber: Record<number, Wave>;
}) {
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm text-fofGunmetal">Judging as</p>
          <p className="font-display text-xl">{judgeName}</p>
        </div>
        <LogoutButton />
      </header>

      <h1 className="mb-4 font-display text-lg tracking-wide text-fofRed">
        YOUR TEAMS
      </h1>

      <div className="space-y-3">
        {teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            judgeId={judgeId}
            initialScans={scansByTeam[team.id] ?? []}
            initialWave={team.wave != null ? wavesByNumber[team.wave] ?? null : null}
          />
        ))}
      </div>

      {teams.length === 0 && (
        <p className="text-fofGunmetal">
          No teams assigned to you yet. Check with the race organizer.
        </p>
      )}
    </main>
  );
}
