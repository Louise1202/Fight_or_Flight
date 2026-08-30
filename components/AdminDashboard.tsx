"use client";

import { useEffect, useState } from "react";
import { formatDuration, getNextAction, Scan } from "@/lib/timing";
import { Wave } from "@/lib/waves";
import LiveMonitor from "./LiveMonitor";
import PasswordInput from "./PasswordInput";

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
  waves,
}: {
  teams: Team[];
  judges: Judge[];
  assignments: Assignment[];
  scans: Scan[];
  teamsWithViewer: string[];
  waves: Wave[];
}) {
  const [rows, setRows] = useState<Team[]>(teams);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [assignmentList, setAssignmentList] = useState<Assignment[]>(assignments);
  const [newJudgeId, setNewJudgeId] = useState(judges[0]?.id ?? "");
  const [newTeamId, setNewTeamId] = useState("");
  const [waveList, setWaveList] = useState<Wave[]>(waves);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const [waveActionId, setWaveActionId] = useState<number | null>(null);

  async function startHeat(waveNumber: number) {
    setWaveActionId(waveNumber);
    const res = await fetch("/api/admin/waves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waveNumber }),
    });
    if (res.ok) {
      setWaveList((prev) =>
        prev.map((w) =>
          w.wave_number === waveNumber ? { ...w, actual_start: new Date().toISOString() } : w
        )
      );
    }
    setWaveActionId(null);
  }

  async function endHeat(waveNumber: number) {
    setWaveActionId(waveNumber);
    const res = await fetch("/api/admin/waves", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waveNumber }),
    });
    if (res.ok) {
      setWaveList((prev) =>
        prev.map((w) =>
          w.wave_number === waveNumber ? { ...w, actual_end: new Date().toISOString() } : w
        )
      );
    }
    setWaveActionId(null);
  }

  async function undoHeat(waveNumber: number, field: "start" | "end") {
    setWaveActionId(waveNumber);
    const res = await fetch("/api/admin/waves", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waveNumber, field }),
    });
    if (res.ok) {
      setWaveList((prev) =>
        prev.map((w) =>
          w.wave_number === waveNumber
            ? { ...w, [field === "end" ? "actual_end" : "actual_start"]: null }
            : w
        )
      );
    }
    setWaveActionId(null);
  }

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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl text-fofRed">RACE HQ — ADMIN</h1>
        <a
          href="/api/admin/export"
          className="rounded border border-fofGunmetal px-3 py-2 text-sm hover:border-fofRed hover:text-fofRed"
        >
          Export to Excel
        </a>
        <a
          href="/admin/qr-codes"
          className="rounded border border-fofGunmetal px-3 py-2 text-sm hover:border-fofRed hover:text-fofRed"
        >
          Print QR codes
        </a>
        <button
          onClick={async () => {
            await fetch("/api/admin/logout", { method: "POST" });
            window.location.href = "/admin/login";
          }}
          className="rounded border border-fofGunmetal px-3 py-2 text-sm text-fofGunmetal hover:border-fofRed hover:text-fofRed"
        >
          Sign out
        </button>
      </div>

      <section className="mb-10">
        <h2 className="mb-2 font-display text-lg">Race day control</h2>
        <p className="mb-3 text-sm text-fofGunmetal">
          Nothing is timed until you start a heat here — the moment you do,
          every judge in that heat sees their clock start on their phone.
          A heat closes itself automatically once every team in it has
          finished; use "End heat" only if a team DNFs and will never cross
          the line.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {waveList.map((w) => {
            const started = !!w.actual_start;
            const ended = !!w.actual_end;
            const scheduled = new Date(w.scheduled_start).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            });
            const busy = waveActionId === w.wave_number;
            return (
              <div
                key={w.wave_number}
                className={`rounded border p-4 text-center ${
                  ended ? "border-fofGunmetal" : started ? "border-fofRed" : "border-fofCharcoal"
                }`}
              >
                <p className="font-display text-lg">Heat {w.wave_number}</p>
                <p className="text-xs text-fofGunmetal">Scheduled {scheduled}</p>

                {!started && (
                  <button
                    onClick={() => startHeat(w.wave_number)}
                    disabled={busy}
                    className="tap-target mt-3 w-full rounded bg-fofRed font-display disabled:opacity-50"
                  >
                    {busy ? "Starting..." : `Start Heat ${w.wave_number}`}
                  </button>
                )}

                {started && !ended && (
                  <>
                    <p className="mt-2 text-sm text-fofRed">
                      Started{" "}
                      {new Date(w.actual_start!).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </p>
                    <p className="font-display text-lg">
                      {formatDuration(now - new Date(w.actual_start!).getTime())}
                    </p>
                    <p className="text-xs text-fofGunmetal">running</p>
                    <button
                      onClick={() => endHeat(w.wave_number)}
                      disabled={busy}
                      className="tap-target mt-3 w-full rounded border border-fofGunmetal font-display disabled:opacity-50"
                    >
                      {busy ? "Ending..." : "End heat"}
                    </button>
                    <button
                      onClick={() => undoHeat(w.wave_number, "start")}
                      disabled={busy}
                      className="mt-2 text-xs text-fofGunmetal underline disabled:opacity-50"
                    >
                      Undo start (mis-click)
                    </button>
                  </>
                )}

                {ended && (
                  <>
                    <p className="mt-2 text-xs text-fofGunmetal">
                      Started{" "}
                      {new Date(w.actual_start!).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <p className="text-sm text-fofGunmetal">
                      Finished{" "}
                      {new Date(w.actual_end!).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </p>
                    <p className="font-display text-lg">
                      {formatDuration(
                        new Date(w.actual_end!).getTime() - new Date(w.actual_start!).getTime()
                      )}
                    </p>
                    <p className="text-xs text-fofGunmetal">total duration</p>
                    <button
                      onClick={() => undoHeat(w.wave_number, "end")}
                      disabled={busy}
                      className="mt-2 text-xs text-fofGunmetal underline disabled:opacity-50"
                    >
                      Reopen heat
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <LiveMonitor />

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
              <th className="p-2">Heat</th>
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
                    <select
                      value={team.division ?? ""}
                      onChange={(e) => updateField(team.id, "division", e.target.value)}
                      className="border-b border-transparent bg-transparent focus:border-fofRed"
                    >
                      <option value="" className="bg-fofBlack" />
                      <option value="Men" className="bg-fofBlack">Men</option>
                      <option value="Women" className="bg-fofBlack">Women</option>
                      <option value="Mixed" className="bg-fofBlack">Mixed</option>
                    </select>
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
            <PasswordInput
              placeholder="Password (min 6 characters)"
              value={judgePassword}
              onChange={setJudgePassword}
              required
              minLength={6}
              className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-3 pr-12"
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
            <PasswordInput
              placeholder="Password (min 6 characters)"
              value={viewerPassword}
              onChange={setViewerPassword}
              required
              minLength={6}
              className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-3 pr-12"
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
