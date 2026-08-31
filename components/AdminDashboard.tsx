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
  const [judgeList, setJudgeList] = useState<Judge[]>(judges);
  const [editingJudgeId, setEditingJudgeId] = useState<string | null>(null);
  const [editJudgeName, setEditJudgeName] = useState("");
  const [editJudgeUsername, setEditJudgeUsername] = useState("");
  const [editJudgePassword, setEditJudgePassword] = useState("");
  const [judgeEditStatus, setJudgeEditStatus] = useState<string | null>(null);
  const [judgeEditBusy, setJudgeEditBusy] = useState(false);

  function startEditJudge(judge: Judge) {
    setEditingJudgeId(judge.id);
    setEditJudgeName(judge.name);
    setEditJudgeUsername("");
    setEditJudgePassword("");
    setJudgeEditStatus(null);
  }

  async function saveJudgeEdit(judgeId: string) {
    setJudgeEditBusy(true);
    setJudgeEditStatus(null);
    const res = await fetch(`/api/admin/judges/${judgeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editJudgeName,
        username: editJudgeUsername || undefined,
        password: editJudgePassword || undefined,
      }),
    });
    const data = await res.json();
    setJudgeEditBusy(false);
    if (!res.ok) {
      setJudgeEditStatus(data.error ?? "Couldn't save changes.");
      return;
    }
    setJudgeList((prev) =>
      prev.map((j) => (j.id === judgeId ? { ...j, name: editJudgeName } : j))
    );
    setEditingJudgeId(null);
  }

  async function deleteJudge(judge: Judge) {
    const confirmed = window.confirm(
      `Delete ${judge.name}'s judge login and all their team assignments? This can't be undone.`
    );
    if (!confirmed) return;

    const res = await fetch(`/api/admin/judges/${judge.id}`, { method: "DELETE" });
    if (res.ok) {
      setJudgeList((prev) => prev.filter((j) => j.id !== judge.id));
      setAssignmentList((prev) => prev.filter((a) => a.judge_id !== judge.id));
      if (newJudgeId === judge.id) setNewJudgeId("");
    } else {
      const data = await res.json();
      window.alert(data.error ?? "Couldn't delete this judge.");
    }
  }
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

  const [editingScheduleFor, setEditingScheduleFor] = useState<number | null>(null);
  const [scheduleTimeInput, setScheduleTimeInput] = useState("");
  const [scheduleSaving, setScheduleSaving] = useState(false);

  function startEditSchedule(wave: Wave) {
    const d = new Date(wave.scheduled_start);
    setScheduleTimeInput(
      `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
    );
    setEditingScheduleFor(wave.wave_number);
  }

  async function saveSchedule(waveNumber: number) {
    setScheduleSaving(true);
    const res = await fetch("/api/admin/waves", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waveNumber, time: scheduleTimeInput }),
    });
    const data = await res.json();
    setScheduleSaving(false);
    if (res.ok) {
      setWaveList((prev) =>
        prev.map((w) =>
          w.wave_number === waveNumber ? { ...w, scheduled_start: data.scheduled_start } : w
        )
      );
      setEditingScheduleFor(null);
    } else {
      window.alert(data.error ?? "Couldn't save the new time.");
    }
  }

  async function undoHeat(waveNumber: number, field: "start" | "end") {
    if (field === "start") {
      const teamIdsInHeat = teams.filter((t) => t.wave === waveNumber).map((t) => t.id);
      const hasScans = scans.some((s: any) => teamIdsInHeat.includes(s.team_id));
      if (hasScans) {
        const confirmed = window.confirm(
          `Teams in Heat ${waveNumber} already have scans recorded. Undoing the start will make their times wrong, since those scans are tied to the old start time - it will NOT clear the scans for you. Only do this if you're about to also fix or clear that data. Continue?`
        );
        if (!confirmed) return;
      }
    }

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

  // --- Reset for new event ---
  const [resetScope, setResetScope] = useState<"race-data" | "full" | null>(null);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetStatus, setResetStatus] = useState<string | null>(null);

  // --- Import from Excel ---
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDate, setImportDate] = useState("");
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    if (!importFile || !importDate) {
      setImportStatus("Choose a file and an event date first.");
      return;
    }
    setImporting(true);
    setImportStatus(null);

    const formData = new FormData();
    formData.append("file", importFile);
    formData.append("eventDate", importDate);

    const res = await fetch("/api/admin/import", { method: "POST", body: formData });
    const data = await res.json();
    setImporting(false);

    if (!res.ok) {
      setImportStatus(data.error ?? "Import failed.");
      return;
    }

    const s = data.summary;
    let msg = `Imported ${s.teamsImported} teams`;
    if (s.wavesImported > 0) msg += `, ${s.wavesImported} heat schedules`;
    if (s.judgeAssignmentsLinked > 0) msg += `, linked ${s.judgeAssignmentsLinked} judge assignments`;
    msg += ".";
    if (s.unmatchedJudgeNames?.length > 0) {
      msg += ` Couldn't match these judge names to an existing login: ${s.unmatchedJudgeNames.join(", ")} - create their logins, then assign them manually below.`;
    }
    setImportStatus(msg);
    setTimeout(() => window.location.reload(), 3000);
  }

  async function runReset() {
    if (resetConfirmText !== "RESET") return;
    setResetting(true);
    setResetStatus(null);
    const res = await fetch("/api/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: resetScope }),
    });
    const data = await res.json();
    setResetting(false);
    if (!res.ok) {
      setResetStatus(data.error ?? "Something went wrong.");
      return;
    }
    setResetStatus("Done. Reloading...");
    setTimeout(() => window.location.reload(), 1200);
  }

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

      <section className="mb-10 rounded border border-fofCharcoal p-4">
        <h2 className="mb-2 font-display text-lg">Import from Excel</h2>
        <p className="mb-3 text-sm text-fofGunmetal">
          Upload a workbook matching the original Race HQ format (a{" "}
          <span className="font-mono">Teams</span> sheet with Team ID, Team
          Name, Athlete 1/2, Division, Heat, Start Time, Judges - and
          optionally a <span className="font-mono">Waves</span> sheet with
          Wave and Scheduled Start). Existing teams with matching IDs are
          updated, not duplicated.
        </p>
        <form onSubmit={runImport} className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-fofGunmetal">Event date</label>
            <input
              type="date"
              value={importDate}
              onChange={(e) => setImportDate(e.target.value)}
              className="tap-target rounded border border-fofGunmetal bg-transparent px-3"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-fofGunmetal">Workbook (.xlsx)</label>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={importing}
            className="tap-target rounded bg-fofRed px-4 font-display disabled:opacity-50"
          >
            {importing ? "Importing..." : "Import"}
          </button>
        </form>
        {importStatus && <p className="mt-2 text-sm text-fofGunmetal">{importStatus}</p>}
      </section>

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

                {editingScheduleFor === w.wave_number ? (
                  <div className="mt-1 flex items-center justify-center gap-1">
                    <input
                      type="time"
                      value={scheduleTimeInput}
                      onChange={(e) => setScheduleTimeInput(e.target.value)}
                      className="rounded border border-fofGunmetal bg-transparent px-1 py-0.5 text-xs"
                    />
                    <button
                      onClick={() => saveSchedule(w.wave_number)}
                      disabled={scheduleSaving}
                      className="text-xs text-fofRed underline disabled:opacity-50"
                    >
                      {scheduleSaving ? "..." : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingScheduleFor(null)}
                      className="text-xs text-fofGunmetal underline"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-fofGunmetal">
                    Scheduled {scheduled}{" "}
                    {!started && (
                      <button
                        onClick={() => startEditSchedule(w)}
                        className="underline"
                        aria-label={`Edit scheduled time for Heat ${w.wave_number}`}
                      >
                        (edit)
                      </button>
                    )}
                  </p>
                )}

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
            {judgeList.map((j) => (
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
          {judgeList.map((judge) => {
            const teamIds = assignmentList
              .filter((a) => a.judge_id === judge.id)
              .map((a) => a.team_id);
            const isEditing = editingJudgeId === judge.id;
            return (
              <li key={judge.id} className="rounded border border-fofCharcoal p-2 text-sm">
                {!isEditing ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
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
                    </div>
                    <div className="flex gap-2 text-xs">
                      <button
                        onClick={() => startEditJudge(judge)}
                        className="text-fofGunmetal underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteJudge(judge)}
                        className="text-fofRed underline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      value={editJudgeName}
                      onChange={(e) => setEditJudgeName(e.target.value)}
                      placeholder="Name"
                      className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-3"
                    />
                    <input
                      value={editJudgeUsername}
                      onChange={(e) => setEditJudgeUsername(e.target.value)}
                      placeholder="New username (leave blank to keep current)"
                      className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-3"
                    />
                    <PasswordInput
                      value={editJudgePassword}
                      onChange={setEditJudgePassword}
                      placeholder="New password (leave blank to keep current)"
                      className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-3 pr-12"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveJudgeEdit(judge.id)}
                        disabled={judgeEditBusy}
                        className="tap-target rounded bg-fofRed px-4 font-display disabled:opacity-50"
                      >
                        {judgeEditBusy ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={() => setEditingJudgeId(null)}
                        className="tap-target rounded border border-fofGunmetal px-4 text-fofGunmetal"
                      >
                        Cancel
                      </button>
                    </div>
                    {judgeEditStatus && (
                      <p className="text-xs text-fofGunmetal">{judgeEditStatus}</p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-12 rounded border-2 border-fofRed p-4">
        <h2 className="mb-2 font-display text-lg text-fofRed">Danger zone</h2>
        <p className="mb-4 text-sm text-fofGunmetal">
          Export to Excel first if you want to keep a record - resetting
          permanently deletes data from the database, it isn't recoverable
          afterward.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded border border-fofCharcoal p-3">
            <p className="font-display text-sm">Reset race data</p>
            <p className="mb-2 text-xs text-fofGunmetal">
              Clears all scans, penalties, and heat start/end times. Keeps
              your teams, judges, and assignments exactly as they are - use
              this to re-run the same event from zero.
            </p>
            <button
              onClick={() => {
                setResetScope("race-data");
                setResetConfirmText("");
                setResetStatus(null);
              }}
              className="rounded border border-fofGunmetal px-3 py-2 text-sm hover:border-fofRed hover:text-fofRed"
            >
              Reset race data...
            </button>
          </div>

          <div className="rounded border border-fofCharcoal p-3">
            <p className="font-display text-sm">Full reset for a new event</p>
            <p className="mb-2 text-xs text-fofGunmetal">
              Deletes everything above, plus every team, judge, judge
              login, and team login. Use this when setting up a
              completely different event on this same app.
            </p>
            <button
              onClick={() => {
                setResetScope("full");
                setResetConfirmText("");
                setResetStatus(null);
              }}
              className="rounded border border-fofRed px-3 py-2 text-sm text-fofRed"
            >
              Full reset...
            </button>
          </div>
        </div>

        {resetScope && (
          <div className="mt-4 rounded border border-fofRed p-3">
            <p className="mb-2 text-sm">
              {resetScope === "full"
                ? "This deletes ALL teams, judges, and logins, in addition to race data. This cannot be undone."
                : "This deletes all scans, penalties, and heat times. Teams and judges stay. This cannot be undone."}
            </p>
            <p className="mb-2 text-sm text-fofGunmetal">
              Type <span className="font-mono text-fofRed">RESET</span> to confirm:
            </p>
            <div className="flex gap-2">
              <input
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                className="tap-target flex-1 rounded border border-fofGunmetal bg-transparent px-3"
              />
              <button
                onClick={runReset}
                disabled={resetConfirmText !== "RESET" || resetting}
                className="tap-target rounded bg-fofRed px-4 font-display disabled:opacity-50"
              >
                {resetting ? "Resetting..." : "Confirm"}
              </button>
              <button
                onClick={() => setResetScope(null)}
                className="tap-target rounded border border-fofGunmetal px-4 text-fofGunmetal"
              >
                Cancel
              </button>
            </div>
            {resetStatus && <p className="mt-2 text-sm text-fofGunmetal">{resetStatus}</p>}
          </div>
        )}
      </section>
    </main>
  );
}
