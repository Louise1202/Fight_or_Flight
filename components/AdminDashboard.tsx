"use client";

import { useState } from "react";
import { getNextAction, Scan } from "@/lib/timing";

type Team = {
  id: string;
  team_name: string;
  athlete_1: string | null;
  athlete_2: string | null;
  division: string | null;
  wave: number | null;
  start_time: string;
};

type Judge = { id: string; name: string };
type Assignment = { judge_id: string; team_id: string };

export default function AdminDashboard({
  teams,
  judges,
  assignments,
  scans,
  teamsWithViewer,
}: {
  teams: Team[];
  judges: Judge[];
  assignments: Assignment[];
  scans: Scan[];
  teamsWithViewer: string[];
}) {
  const [rows, setRows] = useState<Team[]>(teams);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [assignmentList, setAssignmentList] = useState<Assignment[]>(assignments);
  const [newJudgeId, setNewJudgeId] = useState(judges[0]?.id ?? "");
  const [newTeamId, setNewTeamId] = useState("");

  // --- Create judge form state ---
  const [judgeName, setJudgeName] = useState("");
  const [judgeUsername, setJudgeUsername] = useState("");
  const [judgePassword, setJudgePassword] = useState("");
  const [judgeTeamIds, setJudgeTeamIds] = useState<string[]>([]);
  const [creatingJudge, setCreatingJudge] = useState(false);
  const [judgeCreateStatus, setJudgeCreateStatus] = useState<string | null>(null);

  // --- Create team viewer form state ---
  const [viewerTeamId, setViewerTeamId] = useState(teams[0]?.id ?? "");
  const [viewerUsername, setViewerUsername] = useState("");
  const [viewerPassword, setViewerPassword] = useState("");
  const [creatingViewer, setCreatingViewer] = useState(false);
  const [viewerCreateStatus, setViewerCreateStatus] = useState<string | null>(null);

  function updateField(id: string, field: keyof Team, value: string) {
    setRows((prev) =>
      prev.map((t) => (t.id === id ? { ...t, [field]: value } : t))
    );
  }

  async function saveRow(team: Team) {
    setSavingId(team.id);
    await fetch(`/api/admin/teams/${team.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        team_name: team.team_name,
        athlete_1: team.athlete_1,
        athlete_2: team.athlete_2,
        division: team.division,
        wave: team.wave,
        start_time: team.start_time,
      }),
    });
    setSavingId(null);
  }

  async function addAssignment() {
    if (!newJudgeId || !newTeamId) return;
    const res = await fetch("/api/admin/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ judge_id: newJudgeId, team_id: newTeamId.trim() }),
    });
    if (res.ok) {
      setAssignmentList((prev) => [...prev, { judge_id: newJudgeId, team_id: newTeamId.trim() }]);
      setNewTeamId("");
    }
  }

  async function removeAssignment(judge_id: string, team_id: string) {
    const res = await fetch("/api/admin/assignments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ judge_id, team_id }),
    });
    if (res.ok) {
      setAssignmentList((prev) =>
        prev.filter((a) => !(a.judge_id === judge_id && a.team_id === team_id))
      );
    }
  }

  function toggleJudgeTeam(teamId: string) {
    setJudgeTeamIds((prev) =>
      prev.includes(teamId) ? prev.filter((t) => t !== teamId) : [...prev, teamId]
    );
  }

  async function createJudge(e: React.FormEvent) {
    e.preventDefault();
    setJudgeCreateStatus(null);
    setCreatingJudge(true);

    const res = await fetch("/api/admin/judges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: judgeName,
        username: judgeUsername,
        password: judgePassword,
        teamIds: judgeTeamIds,
      }),
    });
    const data = await res.json();
    setCreatingJudge(false);

    if (!res.ok) {
      setJudgeCreateStatus(data.error ?? "Something went wrong.");
      return;
    }

    setJudgeCreateStatus(
      `Created! Give this judge username "${judgeUsername}" and the password you chose.`
    );
    setJudgeName("");
    setJudgeUsername("");
    setJudgePassword("");
    setJudgeTeamIds([]);
    // Simplest reliable way to show the new judge everywhere (list,
    // dropdowns, assignments) without hand-rolling extra state syncing.
    setTimeout(() => window.location.reload(), 1200);
  }

  async function createViewer(e: React.FormEvent) {
    e.preventDefault();
    setViewerCreateStatus(null);
    setCreatingViewer(true);

    const res = await fetch("/api/admin/team-viewers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId: viewerTeamId,
        username: viewerUsername,
        password: viewerPassword,
      }),
    });
    const data = await res.json();
    setCreatingViewer(false);

    if (!res.ok) {
      setViewerCreateStatus(data.error ?? "Something went wrong.");
      return;
    }

    setViewerCreateStatus(
      `Created! Give ${viewerTeamId} username "${viewerUsername}" and the password you chose.`
    );
    setViewerUsername("");
    setViewerPassword("");
    setTimeout(() => window.location.reload(), 1200);
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl text-fofRed">RACE HQ — ADMIN</h1>
        <a
          href="/api/admin/export"
          className="rounded border border-fofGunmetal px-3 py-2 text-sm hover:border-fofRed hover:text-fofRed"
        >
          Export to Excel
        </a>
      </div>

      <section className="mb-10 overflow-x-auto">
        <h2 className="mb-2 font-display text-lg">Teams</h2>
        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-fofGunmetal text-left text-fofGunmetal">
              <th className="p-2">ID</th>
              <th className="p-2">Team name</th>
              <th className="p-2">Athlete 1</th>
              <th className="p-2">Athlete 2</th>
              <th className="p-2">Division</th>
              <th className="p-2">Wave</th>
              <th className="p-2">Progress</th>
              <th className="p-2">Viewer login</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((team) => {
              const teamScans = scans.filter((s: any) => (s as any).team_id === team.id);
              const next = getNextAction(teamScans as Scan[]);
              const hasViewer = teamsWithViewer.includes(team.id);
              return (
                <tr key={team.id} className="border-b border-fofCharcoal">
                  <td className="p-2 font-mono text-xs">{team.id}</td>
                  <td className="p-2">
                    <input
                      value={team.team_name ?? ""}
                      onChange={(e) => updateField(team.id, "team_name", e.target.value)}
                      className="w-32 border-b border-transparent bg-transparent focus:border-fofRed"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      value={team.athlete_1 ?? ""}
                      onChange={(e) => updateField(team.id, "athlete_1", e.target.value)}
                      className="w-28 border-b border-transparent bg-transparent focus:border-fofRed"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      value={team.athlete_2 ?? ""}
                      onChange={(e) => updateField(team.id, "athlete_2", e.target.value)}
                      className="w-28 border-b border-transparent bg-transparent focus:border-fofRed"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      value={team.division ?? ""}
                      onChange={(e) => updateField(team.id, "division", e.target.value)}
                      className="w-24 border-b border-transparent bg-transparent focus:border-fofRed"
                    />
                  </td>
                  <td className="p-2">
                    <input
                      value={team.wave ?? ""}
                      onChange={(e) => updateField(team.id, "wave", e.target.value)}
                      className="w-12 border-b border-transparent bg-transparent focus:border-fofRed"
                    />
                  </td>
                  <td className="p-2 text-fofGunmetal">
                    {next.isFinished ? "Finished" : next.label}
                  </td>
                  <td className="p-2 text-xs">
                    {hasViewer ? (
                      <span className="text-fofGunmetal">✓ set up</span>
                    ) : (
                      <span className="text-fofRed">none yet</span>
                    )}
                  </td>
                  <td className="p-2">
                    <button
                      onClick={() => saveRow(team)}
                      disabled={savingId === team.id}
                      className="rounded border border-fofRed px-2 py-1 text-fofRed disabled:opacity-50"
                    >
                      {savingId === team.id ? "Saving..." : "Save"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="mb-10 grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="mb-2 font-display text-lg">Create a judge login</h2>
          <form onSubmit={createJudge} className="space-y-2 rounded border border-fofCharcoal p-4">
            <input
              placeholder="Judge's name (e.g. Nicolene)"
              value={judgeName}
              onChange={(e) => setJudgeName(e.target.value)}
              required
              className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-3"
            />
            <input
              placeholder="Username (e.g. nicolene)"
              value={judgeUsername}
              onChange={(e) => setJudgeUsername(e.target.value)}
              required
              className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-3"
            />
            <input
              type="text"
              placeholder="Password (min 6 characters)"
              value={judgePassword}
              onChange={(e) => setJudgePassword(e.target.value)}
              required
              minLength={6}
              className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-3"
            />
            <div className="max-h-36 overflow-y-auto rounded border border-fofCharcoal p-2 text-sm">
              <p className="mb-1 text-fofGunmetal">Assign teams (optional, can add later):</p>
              {teams.map((t) => (
                <label key={t.id} className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={judgeTeamIds.includes(t.id)}
                    onChange={() => toggleJudgeTeam(t.id)}
                  />
                  {t.id} — {t.team_name}
                </label>
              ))}
            </div>
            <button
              type="submit"
              disabled={creatingJudge}
              className="tap-target w-full rounded bg-fofRed font-display disabled:opacity-50"
            >
              {creatingJudge ? "Creating..." : "Create judge login"}
            </button>
            {judgeCreateStatus && (
              <p className="text-sm text-fofGunmetal">{judgeCreateStatus}</p>
            )}
          </form>
        </div>

        <div>
          <h2 className="mb-2 font-display text-lg">Create a team login</h2>
          <form onSubmit={createViewer} className="space-y-2 rounded border border-fofCharcoal p-4">
            <select
              value={viewerTeamId}
              onChange={(e) => setViewerTeamId(e.target.value)}
              className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-3"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id} className="bg-fofBlack">
                  {t.id} — {t.team_name} {teamsWithViewer.includes(t.id) ? "(already has one)" : ""}
                </option>
              ))}
            </select>
            <input
              placeholder="Username (e.g. team01)"
              value={viewerUsername}
              onChange={(e) => setViewerUsername(e.target.value)}
              required
              className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-3"
            />
            <input
              type="text"
              placeholder="Password (min 6 characters)"
              value={viewerPassword}
              onChange={(e) => setViewerPassword(e.target.value)}
              required
              minLength={6}
              className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-3"
            />
            <button
              type="submit"
              disabled={creatingViewer}
              className="tap-target w-full rounded bg-fofRed font-display disabled:opacity-50"
            >
              {creatingViewer ? "Creating..." : "Create team login"}
            </button>
            {viewerCreateStatus && (
              <p className="text-sm text-fofGunmetal">{viewerCreateStatus}</p>
            )}
          </form>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-display text-lg">Judges &amp; assignments</h2>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={newJudgeId}
            onChange={(e) => setNewJudgeId(e.target.value)}
            className="rounded border border-fofGunmetal bg-transparent px-2 py-1"
          >
            {judges.map((j) => (
              <option key={j.id} value={j.id} className="bg-fofBlack">
                {j.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Team ID (e.g. FF073001)"
            value={newTeamId}
            onChange={(e) => setNewTeamId(e.target.value.toUpperCase())}
            className="rounded border border-fofGunmetal bg-transparent px-2 py-1"
          />
          <button
            onClick={addAssignment}
            className="rounded border border-fofRed px-3 py-1 text-fofRed"
          >
            Assign
          </button>
        </div>

        <ul className="space-y-2">
          {judges.map((judge) => {
            const teamIds = assignmentList
              .filter((a) => a.judge_id === judge.id)
              .map((a) => a.team_id);
            return (
              <li key={judge.id} className="text-sm">
                <span className="font-display">{judge.name}</span>{" "}
                {teamIds.length === 0 && (
                  <span className="text-fofGunmetal">— no teams assigned</span>
                )}
                {teamIds.map((tid) => (
                  <span
                    key={tid}
                    className="ml-2 inline-flex items-center gap-1 rounded bg-fofCharcoal px-2 py-0.5 font-mono text-xs"
                  >
                    {tid}
                    <button
                      onClick={() => removeAssignment(judge.id, tid)}
                      className="text-fofRed"
                      aria-label={`Remove ${tid} from ${judge.name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
