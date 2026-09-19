"use client";

import { useEffect, useState } from "react";
import { formatDuration, getNextAction, Scan } from "@/lib/timing";
import { Wave, hasWaveStarted } from "@/lib/waves";
import { StationDef } from "@/lib/stations";
import { useSharedTheme } from "@/lib/useSharedTheme";
import LiveMonitor from "./LiveMonitor";
import PasswordInput from "./PasswordInput";
import CollapsibleSection from "./CollapsibleSection";

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
  initialTheme,
  stations,
  orphanedTeams,
  duplicateTeamNames,
}: {
  teams: Team[];
  judges: Judge[];
  assignments: Assignment[];
  scans: Scan[];
  teamsWithViewer: string[];
  waves: Wave[];
  initialTheme: "dark" | "light";
  stations: StationDef[];
  orphanedTeams: { id: string; team_name: string }[];
  duplicateTeamNames: { name: string; wave: number; count: number }[];
}) {
  const syncedTheme = useSharedTheme(initialTheme);
  const [themeOverride, setThemeOverride] = useState<"dark" | "light" | null>(null);
  const theme = themeOverride ?? syncedTheme;
  const [togglingTheme, setTogglingTheme] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);

  // Once the shared (DB-backed) value catches up to what we set locally,
  // drop the override and go back to trusting the synced value directly -
  // this is just for instant feedback on the admin's own click, not a
  // permanent second source of truth.
  useEffect(() => {
    if (themeOverride && syncedTheme === themeOverride) setThemeOverride(null);
  }, [syncedTheme, themeOverride]);

  async function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setThemeOverride(next); // instant flip on THIS screen, regardless of Realtime/RLS
    setThemeError(null);
    setTogglingTheme(true);
    try {
      const res = await fetch("/api/admin/settings/theme", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setThemeError(body?.error ?? "Couldn't save - try again.");
        setThemeOverride(null); // revert the optimistic flip, it didn't actually stick
      }
    } catch {
      setThemeError("Couldn't reach the server - check your connection.");
      setThemeOverride(null);
    } finally {
      setTogglingTheme(false);
    }
  }

  const [stationRows, setStationRows] = useState<StationDef[]>(stations);
  const [newStationName, setNewStationName] = useState("");
  const [newStationIsRun, setNewStationIsRun] = useState(false);
  const [addingStation, setAddingStation] = useState(false);
  const [stationError, setStationError] = useState<string | null>(null);

  // Editing names/run-flags is staged: nothing saves until "Save changes"
  // is clicked, so a half-finished edit can never accidentally go live.
  const [editingStations, setEditingStations] = useState(false);
  const [draftStations, setDraftStations] = useState<StationDef[]>([]);
  const [savingStations, setSavingStations] = useState(false);

  async function addStation(e: React.FormEvent) {
    e.preventDefault();
    if (!newStationName.trim()) return;
    setAddingStation(true);
    setStationError(null);
    const res = await fetch("/api/admin/stations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newStationName.trim(), isRun: newStationIsRun }),
    });
    const data = await res.json();
    setAddingStation(false);
    if (!res.ok) {
      setStationError(data.error ?? "Couldn't add that station.");
      return;
    }
    setStationRows((rows) => [...rows, data.station]);
    setNewStationName("");
    setNewStationIsRun(false);
  }

  function startEditStations() {
    setDraftStations(stationRows);
    setEditingStations(true);
    setStationError(null);
  }

  function updateDraftStation(number: number, patch: Partial<StationDef>) {
    setDraftStations((rows) => rows.map((r) => (r.number === number ? { ...r, ...patch } : r)));
  }

  async function saveStationEdits() {
    setSavingStations(true);
    setStationError(null);
    // Only the rows that actually changed get sent - a station nobody
    // touched is never re-saved.
    const changed = draftStations.filter((d) => {
      const original = stationRows.find((r) => r.number === d.number);
      return original && (original.name !== d.name || original.isRun !== d.isRun);
    });
    for (const s of changed) {
      const res = await fetch(`/api/admin/stations/${s.number}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: s.name, isRun: s.isRun }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setStationError(`Station ${s.number}: ${data?.error ?? "couldn't save"}`);
        setSavingStations(false);
        return;
      }
    }
    setStationRows(draftStations);
    setSavingStations(false);
    setEditingStations(false);
  }

  async function deleteStation(number: number) {
    setStationError(null);
    const res = await fetch(`/api/admin/stations/${number}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setStationError(data.error ?? "Couldn't remove that station.");
      return;
    }
    setStationRows((rows) => rows.filter((s) => s.number !== number));
  }

  // --- Reordering stations (drag up/down) ---
  const [reorderingStations, setReorderingStations] = useState(false);
  const [draftOrder, setDraftOrder] = useState<StationDef[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  function startReorderStations() {
    setDraftOrder(stationRows);
    setReorderingStations(true);
    setStationError(null);
  }

  function moveDraftStation(from: number, to: number) {
    setDraftOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function saveStationOrder() {
    setSavingOrder(true);
    setStationError(null);
    const res = await fetch("/api/admin/stations/reorder", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: draftOrder.map((s) => s.number) }),
    });
    const data = await res.json();
    setSavingOrder(false);
    if (!res.ok) {
      setStationError(data.error ?? "Couldn't save the new order.");
      return;
    }
    // Numbers were reassigned server-side to match the new order (1, 2,
    // 3...) - rebuild the local list the same way so it's showing the
    // real current numbers, not the old ones the drag started from.
    setStationRows(draftOrder.map((s, i) => ({ number: i + 1, name: s.name, isRun: s.isRun })));
    setReorderingStations(false);
  }

  // --- Duplicate team cleanup (leftover test data, not automatic) ---
  type DupTeam = { id: string; team_name: string; athlete_1: string | null; athlete_2: string | null; wave: number | null };
  const [dupGroups, setDupGroups] = useState<{ keep: DupTeam; remove: DupTeam[]; hasScans: boolean }[] | null>(null);
  const [dupLoading, setDupLoading] = useState(false);
  const [dupDeleting, setDupDeleting] = useState(false);
  const [dupError, setDupError] = useState<string | null>(null);
  const [dupResult, setDupResult] = useState<string | null>(null);

  async function findDuplicateTeams() {
    setDupLoading(true);
    setDupError(null);
    setDupResult(null);
    const res = await fetch("/api/admin/duplicate-teams");
    const data = await res.json();
    setDupLoading(false);
    if (!res.ok) {
      setDupError(data.error ?? "Couldn't check for duplicates.");
      return;
    }
    setDupGroups(data.groups);
  }

  async function deleteDuplicateTeams() {
    if (!dupGroups) return;
    const ids = dupGroups.filter((g) => !g.hasScans).flatMap((g) => g.remove.map((t) => t.id));
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} duplicate team(s)? This can't be undone.`)) return;
    setDupDeleting(true);
    setDupError(null);
    const res = await fetch("/api/admin/duplicate-teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const data = await res.json();
    setDupDeleting(false);
    if (!res.ok) {
      setDupError(data.error ?? "Couldn't delete duplicates.");
      return;
    }
    setDupResult(`Deleted ${data.deleted} duplicate team(s).`);
    setDupGroups(null);
    window.setTimeout(() => window.location.reload(), 2000);
  }

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
  const [newTeamIds, setNewTeamIds] = useState<string[]>([]);
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
      setEditingScheduleFor(null);
      // Any team ids that needed to change (this heat's, or any other
      // heat's that happened to be stale) were already fixed
      // automatically. Reload so the heat card and the roster table
      // both show the real current time and ids, no admin action needed.
      window.location.reload();
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

  // --- Edit an existing team login ---
  const [editingViewerFor, setEditingViewerFor] = useState<string | null>(null);
  const [editViewerUsername, setEditViewerUsername] = useState("");
  const [editViewerPassword, setEditViewerPassword] = useState("");
  const [editViewerLoading, setEditViewerLoading] = useState(false);
  const [editViewerSaving, setEditViewerSaving] = useState(false);
  const [editViewerStatus, setEditViewerStatus] = useState<string | null>(null);
  const [editViewerDuplicates, setEditViewerDuplicates] = useState<{ id: string; username: string }[] | null>(null);

  async function loadViewers(teamId: string) {
    setEditViewerLoading(true);
    const res = await fetch(`/api/admin/team-viewers?teamId=${teamId}`);
    const data = await res.json();
    setEditViewerLoading(false);
    if (!res.ok) {
      setEditViewerStatus(data.error ?? "Couldn't look up this login.");
      return;
    }
    const viewers: { id: string; username: string }[] = data.viewers ?? [];
    if (viewers.length > 1) {
      // More than one login is linked to this team - editing needs to
      // wait until the admin picks which one to keep.
      setEditViewerDuplicates(viewers);
      setEditViewerUsername("");
    } else {
      setEditViewerDuplicates(null);
      setEditViewerUsername(viewers[0]?.username ?? "");
    }
  }

  async function startEditViewer(teamId: string) {
    setEditingViewerFor(teamId);
    setEditViewerUsername("");
    setEditViewerPassword("");
    setEditViewerStatus(null);
    setEditViewerDuplicates(null);
    await loadViewers(teamId);
  }

  async function deleteDuplicateViewer(teamId: string, viewerId: string) {
    if (!window.confirm("Delete this login? Whoever has these details won't be able to sign in with them anymore.")) return;
    setEditViewerLoading(true);
    const res = await fetch(`/api/admin/team-viewers?viewerId=${viewerId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setEditViewerLoading(false);
      setEditViewerStatus(data.error ?? "Couldn't delete that login.");
      return;
    }
    // Re-check - if only one is left now, this drops straight into the
    // normal edit form instead of the duplicate list.
    await loadViewers(teamId);
  }

  async function deleteAllViewers(teamId: string, count: number) {
    if (
      !window.confirm(
        `Delete all ${count} logins for this team? None of them will work anymore - you'll need to create one fresh login afterward.`
      )
    )
      return;
    setEditViewerLoading(true);
    const res = await fetch(`/api/admin/team-viewers?teamId=${teamId}`, { method: "DELETE" });
    const data = await res.json();
    setEditViewerLoading(false);
    if (!res.ok) {
      setEditViewerStatus(data.error ?? "Couldn't delete these logins.");
      return;
    }
    setEditingViewerFor(null);
    window.location.reload();
  }

  async function saveEditViewer(teamId: string) {
    setEditViewerSaving(true);
    setEditViewerStatus(null);
    const res = await fetch("/api/admin/team-viewers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teamId,
        username: editViewerUsername || undefined,
        password: editViewerPassword || undefined,
      }),
    });
    const data = await res.json();
    setEditViewerSaving(false);
    if (!res.ok) {
      setEditViewerStatus(data.error ?? "Couldn't save this login.");
      return;
    }
    setEditViewerStatus("Saved.");
    setEditViewerPassword("");
    window.setTimeout(() => setEditingViewerFor(null), 1200);
  }

  // --- Build the event: add a team, add a heat ---
  const emptyNewTeam = {
    team_name: "",
    athlete_1: "",
    athlete_2: "",
    division: "",
    wave: "",
  };
  const [newTeam, setNewTeam] = useState(emptyNewTeam);
  const [addingTeam, setAddingTeam] = useState(false);
  const [addTeamStatus, setAddTeamStatus] = useState<string | null>(null);

  const [newHeatTime, setNewHeatTime] = useState("");
  const [newHeatDate, setNewHeatDate] = useState("");
  const [addingHeat, setAddingHeat] = useState(false);
  const [heatStatus, setHeatStatus] = useState<string | null>(null);

  // Original heat number for each team, so we can tell when a Save is
  // actually moving a team to another heat (which re-generates its ID and
  // needs a reload to pick up).
  const originalWaveById = new Map(teams.map((t) => [t.id, t.wave]));
  const teamCountByWave = new Map<number, number>();
  for (const t of rows) {
    if (t.wave != null) {
      teamCountByWave.set(t.wave, (teamCountByWave.get(t.wave) ?? 0) + 1);
    }
  }
  const sortedWaves = [...waveList].sort(
    (a, b) =>
      new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime()
  );

  async function addTeam(e: React.FormEvent) {
    e.preventDefault();
    setAddTeamStatus(null);
    if (!newTeam.team_name.trim() || !newTeam.wave) {
      setAddTeamStatus("A team name and a heat are required.");
      return;
    }
    setAddingTeam(true);
    const res = await fetch("/api/admin/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...newTeam, wave: Number(newTeam.wave) }),
    });
    const data = await res.json();
    setAddingTeam(false);
    if (!res.ok) {
      setAddTeamStatus(data.error ?? "Couldn't add the team.");
      return;
    }
    setAddTeamStatus(`Added ${data.team.id}. Reloading...`);
    setNewTeam(emptyNewTeam);
    setTimeout(() => window.location.reload(), 900);
  }

  async function deleteTeam(team: Team) {
    const confirmed = window.confirm(
      `Delete ${team.id} (${team.team_name || "unnamed"})? This also removes any scans, penalties, judge assignments, and this team's own login. It can't be undone.`
    );
    if (!confirmed) return;
    const res = await fetch(`/api/admin/teams/${team.id}`, { method: "DELETE" });
    if (res.ok) {
      setRows((prev) => prev.filter((t) => t.id !== team.id));
      setAssignmentList((prev) => prev.filter((a) => a.team_id !== team.id));
    } else {
      const data = await res.json().catch(() => null);
      window.alert(data?.error ?? "Couldn't delete this team.");
    }
  }

  async function addHeat(e: React.FormEvent) {
    e.preventDefault();
    setHeatStatus(null);
    if (!/^\d{2}:\d{2}$/.test(newHeatTime)) {
      setHeatStatus("Enter a start time first.");
      return;
    }
    setAddingHeat(true);
    const res = await fetch("/api/admin/heats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        time: newHeatTime,
        date: newHeatDate || undefined,
      }),
    });
    const data = await res.json();
    setAddingHeat(false);
    if (!res.ok) {
      setHeatStatus(data.error ?? "Couldn't add the heat.");
      return;
    }
    setWaveList((prev) => [...prev, data.wave]);
    setNewHeatTime("");
    setNewHeatDate("");
  }

  async function removeHeat(waveNumber: number) {
    if (!window.confirm(`Remove Heat ${waveNumber}?`)) return;
    const res = await fetch("/api/admin/heats", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waveNumber }),
    });
    if (res.ok) {
      setWaveList((prev) => prev.filter((w) => w.wave_number !== waveNumber));
    } else {
      const data = await res.json().catch(() => null);
      window.alert(data?.error ?? "Couldn't remove this heat.");
    }
  }

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

  // --- Event report (export/edit/re-import corrections) ---
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [reportUploading, setReportUploading] = useState(false);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [reportErrors, setReportErrors] = useState<string[]>([]);

  async function runEventReportImport(e: React.FormEvent) {
    e.preventDefault();
    if (!reportFile) {
      setReportStatus("Choose a file first.");
      return;
    }
    setReportUploading(true);
    setReportStatus(null);
    setReportErrors([]);

    const formData = new FormData();
    formData.append("file", reportFile);

    const res = await fetch("/api/admin/event-report", { method: "POST", body: formData });
    const data = await res.json();
    setReportUploading(false);

    if (!res.ok) {
      setReportStatus(data.error ?? "Upload failed.");
      return;
    }

    const s = data.summary;
    const parts: string[] = [];
    if (s.stationsAdded) parts.push(`${s.stationsAdded} station(s) added`);
    if (s.stationsUpdated) parts.push(`${s.stationsUpdated} station(s) renamed`);
    if (s.stationsDeleted) parts.push(`${s.stationsDeleted} station(s) deleted`);
    if (s.heatsAdded) parts.push(`${s.heatsAdded} heat(s) added`);
    if (s.heatsUpdated) parts.push(`${s.heatsUpdated} heat(s) updated`);
    if (s.heatsDeleted) parts.push(`${s.heatsDeleted} heat(s) deleted`);
    if (s.teamsAdded) parts.push(`${s.teamsAdded} team(s) added`);
    if (s.teamsUpdated) parts.push(`${s.teamsUpdated} team(s) updated`);
    if (s.teamsDeleted) parts.push(`${s.teamsDeleted} team(s) deleted`);
    setReportStatus(parts.length > 0 ? parts.join(", ") + "." : "Nothing changed.");
    setReportErrors(data.errors ?? []);
    if ((data.errors ?? []).length === 0) {
      setTimeout(() => window.location.reload(), 2500);
    }
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
    const movingHeat =
      String(team.wave ?? "") !== String(originalWaveById.get(team.id) ?? "");
    const res = await fetch(`/api/admin/teams/${team.id}`, {
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
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      window.alert(data?.error ?? "Couldn't save this team.");
      return;
    }
    // A heat change re-generates the team's ID on the server - reload so
    // the table, QR sheet and assignment lists all pick up the new ID.
    if (movingHeat) window.location.reload();
  }

  async function addAssignment() {
    if (!newJudgeId || newTeamIds.length === 0) return;
    const added: Assignment[] = [];
    for (const teamId of newTeamIds) {
      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ judge_id: newJudgeId, team_id: teamId }),
      });
      if (res.ok) added.push({ judge_id: newJudgeId, team_id: teamId });
    }
    if (added.length > 0) {
      setAssignmentList((prev) => [...prev, ...added]);
    }
    setNewTeamIds([]);
  }

  function toggleNewTeamId(teamId: string) {
    setNewTeamIds((prev) =>
      prev.includes(teamId) ? prev.filter((t) => t !== teamId) : [...prev, teamId]
    );
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
    <main
      data-theme={theme}
      className="ground min-h-screen bg-fofBlack text-fofPaper mx-auto max-w-6xl px-4 py-8"
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-2xl text-fofRed">RACE HQ - ADMIN</h1>
        <button
          onClick={toggleTheme}
          disabled={togglingTheme}
          className="rounded border border-fofGunmetal px-3 py-2 text-sm hover:border-fofRed hover:text-fofRed disabled:opacity-50"
        >
          {theme === "dark" ? "☀ Light mode" : "☾ Dark mode"}
        </button>
        {themeError && <span className="text-xs text-fofRed">{themeError}</span>}
        {/* Hidden for now at Louise's request - not deleted, just not shown yet. */}
        {false && (
        <a
          href="/leaderboard"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-fofGunmetal px-3 py-2 text-sm hover:border-fofRed hover:text-fofRed"
        >
          Leaderboard
        </a>
        )}
        <a
          href="/api/admin/export"
          className="rounded border border-fofGunmetal px-3 py-2 text-sm hover:border-fofRed hover:text-fofRed"
        >
          Export to Excel
        </a>
        <a
          href="/api/admin/team-logins-report"
          className="rounded border border-fofGunmetal px-3 py-2 text-sm hover:border-fofRed hover:text-fofRed"
        >
          Team Logins
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

      {/* Hidden for now at Louise's request - not deleted, just not
          rendered. Flip this back to true (or remove the wrapper) to
          bring it back. */}
      {false && (
      <CollapsibleSection title="Import from Excel" defaultOpen={false}>
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
            className="tap-target rounded btn-stamped px-4 font-display disabled:opacity-50"
          >
            {importing ? "Importing..." : "Import"}
          </button>
        </form>
        {importStatus && <p className="mt-2 text-sm text-fofGunmetal">{importStatus}</p>}
      </CollapsibleSection>
      )}

      <CollapsibleSection title="Event report" defaultOpen={true}>
        <p className="mb-3 text-sm text-fofGunmetal">
          Download the current event - stations, heats, and teams - as a
          spreadsheet, make corrections in Excel (add a station, move a
          team to a different heat, delete one, add or remove a heat),
          then upload it back here. Station and Team IDs are always
          recalculated by the system, never typed by hand - this is the
          safe way to make bulk corrections without risking the
          duplicate/mismatched-ID issue that came up earlier. Building a
          brand new event from scratch? Start from the blank template
          instead.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <a
            href="/api/admin/event-report"
            className="tap-target inline-block rounded border border-fofGunmetal px-4 py-2 text-sm font-display hover:border-fofRed hover:text-fofRed"
          >
            Download event report
          </a>
          <a
            href="/api/admin/event-report?blank=1"
            className="tap-target inline-block rounded border border-fofGunmetal px-4 py-2 text-sm font-display hover:border-fofRed hover:text-fofRed"
          >
            Download blank template
          </a>
        </div>
        <form onSubmit={runEventReportImport} className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-fofGunmetal">Corrected workbook (.xlsx)</label>
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setReportFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={reportUploading}
            className="tap-target rounded btn-stamped px-4 font-display disabled:opacity-50"
          >
            {reportUploading ? "Applying..." : "Apply corrections"}
          </button>
        </form>
        {reportStatus && <p className="mt-2 text-sm text-fofGunmetal">{reportStatus}</p>}
        {reportErrors.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-fofRed">
            {reportErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      {orphanedTeams.length > 0 && (
        <p className="mb-6 text-sm text-fofRed">
          {orphanedTeams.length} team(s) belong to a heat that no longer exists
          ({orphanedTeams.map((o) => o.id).join(", ")}) - these can't be
          auto-fixed since there's nothing to put them back into. Delete them
          or assign them to a real heat in the Teams table below.
        </p>
      )}

      {duplicateTeamNames.length > 0 && (
        <p className="mb-6 text-sm text-fofRed">
          {duplicateTeamNames.length} name(s) are used by more than one team within
          the SAME heat ({duplicateTeamNames.map((d) => `"${d.name}" in heat ${d.wave} (${d.count}x)`).join(", ")}) -
          reusing a name across different heats is fine, but two teams sharing a
          name in the same heat can't be told apart there. Worth giving one of
          them a distinct name in the Teams table below.
        </p>
      )}

      <CollapsibleSection title="Clean up duplicate teams" defaultOpen={true}>
        <p className="mb-3 text-sm text-fofGunmetal">
          Finds teams in the same heat with identical athlete names -
          almost always leftover copies from testing, not real teams.
          Nothing is deleted until you review the list below and confirm.
          A team that already has a scan recorded is never touched, even
          if it looks like a duplicate.
        </p>
        <button
          onClick={findDuplicateTeams}
          disabled={dupLoading}
          className="tap-target rounded border border-fofGunmetal px-4 py-2 text-sm font-display hover:border-fofRed hover:text-fofRed disabled:opacity-50"
        >
          {dupLoading ? "Checking..." : "Find duplicates"}
        </button>
        {dupError && <p className="mt-2 text-sm text-fofRed">{dupError}</p>}
        {dupResult && <p className="mt-2 text-sm text-fofGunmetal">{dupResult}</p>}

        {dupGroups && (
          <div className="mt-4">
            {dupGroups.length === 0 ? (
              <p className="text-sm text-fofGunmetal">No duplicate teams found.</p>
            ) : (
              <>
                <ul className="mb-3 max-h-80 space-y-3 overflow-y-auto text-sm">
                  {dupGroups.map((g) => (
                    <li key={g.keep.id} className="border-b border-fofCharcoal pb-2">
                      <p className="text-fofGunmetal">
                        {g.keep.athlete_1} &amp; {g.keep.athlete_2} - heat {g.keep.wave}
                        {g.hasScans && (
                          <span className="ml-2 text-fofRed">
                            (has a scan recorded - none of this group will be touched)
                          </span>
                        )}
                      </p>
                      <p>
                        Keeping: <span className="text-fofPaper">{g.keep.id} ({g.keep.team_name})</span>
                      </p>
                      <p className="text-fofRed">
                        {g.hasScans ? "Would remove" : "Removing"}:{" "}
                        {g.remove.map((t) => `${t.id} (${t.team_name})`).join(", ")}
                      </p>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={deleteDuplicateTeams}
                  disabled={dupDeleting || dupGroups.every((g) => g.hasScans)}
                  className="tap-target rounded btn-stamped px-4 font-display disabled:opacity-50"
                >
                  {dupDeleting
                    ? "Deleting..."
                    : `Delete ${dupGroups.filter((g) => !g.hasScans).flatMap((g) => g.remove).length} duplicate(s)`}
                </button>
              </>
            )}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Stations" defaultOpen={true}>
        <p className="mb-3 text-sm text-fofGunmetal">
          The course, in order. Renaming is always safe. Reordering (drag
          up or down) and adding/removing stations are only available
          before any scan has been recorded anywhere in the event -
          station numbers aren't linked to race data by anything that
          could catch a mismatch, so changing the order once real times
          exist would silently make an already-recorded time mean the
          wrong exercise.
        </p>

        {!reorderingStations && !editingStations && (
          <div className="mb-3 flex gap-2">
            <button
              onClick={startReorderStations}
              className="tap-target rounded border border-fofGunmetal px-4 py-2 text-sm font-display hover:border-fofRed hover:text-fofRed"
            >
              Edit order
            </button>
            <button
              onClick={startEditStations}
              className="tap-target rounded border border-fofGunmetal px-4 py-2 text-sm font-display hover:border-fofRed hover:text-fofRed"
            >
              Edit stations
            </button>
          </div>
        )}

        {reorderingStations && (
          <div className="mb-3 flex gap-2">
            <button
              onClick={saveStationOrder}
              disabled={savingOrder}
              className="tap-target rounded btn-stamped px-4 font-display disabled:opacity-50"
            >
              {savingOrder ? "Saving..." : "Save order"}
            </button>
            <button
              onClick={() => setReorderingStations(false)}
              className="tap-target rounded border border-fofGunmetal px-4 py-2 text-sm text-fofGunmetal"
            >
              Cancel
            </button>
          </div>
        )}

        {editingStations && (
          <div className="mb-3 flex gap-2">
            <button
              onClick={saveStationEdits}
              disabled={savingStations}
              className="tap-target rounded btn-stamped px-4 font-display disabled:opacity-50"
            >
              {savingStations ? "Saving..." : "Save changes"}
            </button>
            <button
              onClick={() => setEditingStations(false)}
              disabled={savingStations}
              className="tap-target rounded border border-fofGunmetal px-4 py-2 text-sm text-fofGunmetal"
            >
              Cancel
            </button>
          </div>
        )}

        {reorderingStations ? (
          <ul className="mb-3 space-y-1">
            {draftOrder.map((s, i) => (
              <li
                key={s.number}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null && dragIndex !== i) moveDraftStation(dragIndex, i);
                  setDragIndex(null);
                }}
                className="flex cursor-move items-center gap-2 border-b border-fofCharcoal bg-fofPanel py-1.5"
              >
                <span className="pl-1 text-fofGunmetal" aria-hidden="true">
                  ⠿
                </span>
                <span className="w-8 shrink-0 text-sm text-fofGunmetal">{i + 1}.</span>
                <span className="flex-1 text-sm">
                  {s.name}
                  {s.isRun && (
                    <span className="ml-2 rounded border border-fofGunmetal px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fofGunmetal">
                      Run
                    </span>
                  )}
                </span>
                <div className="flex flex-col pr-1">
                  <button
                    type="button"
                    aria-label={`Move ${s.name} up`}
                    disabled={i === 0}
                    onClick={() => moveDraftStation(i, i - 1)}
                    className="text-xs text-fofGunmetal disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${s.name} down`}
                    disabled={i === draftOrder.length - 1}
                    onClick={() => moveDraftStation(i, i + 1)}
                    className="text-xs text-fofGunmetal disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : editingStations ? (
          <ul className="mb-3 space-y-1">
            {draftStations.map((s) => (
              <li key={s.number} className="flex items-center gap-2 border-b border-fofCharcoal py-1.5">
                <span className="w-8 shrink-0 text-sm text-fofGunmetal">{s.number}.</span>
                <input
                  value={s.name}
                  onChange={(e) => updateDraftStation(s.number, { name: e.target.value })}
                  className="tap-target flex-1 rounded border border-fofGunmetal bg-transparent px-2 py-1 text-sm"
                />
                <label className="flex items-center gap-1 text-xs text-fofGunmetal" title="This is a run, not an exercise">
                  <input
                    type="checkbox"
                    checked={s.isRun}
                    onChange={(e) => updateDraftStation(s.number, { isRun: e.target.checked })}
                  />
                  Run
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="mb-3 space-y-1">
            {stationRows.map((s) => (
              <li key={s.number} className="flex items-center gap-2 border-b border-fofCharcoal py-1.5">
                <span className="w-8 shrink-0 text-sm text-fofGunmetal">{s.number}.</span>
                <span className="flex-1 text-sm">
                  {s.name}
                  {s.isRun && (
                    <span className="ml-2 rounded border border-fofGunmetal px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fofGunmetal">
                      Run
                    </span>
                  )}
                </span>
                {s.number === Math.max(...stationRows.map((r) => r.number)) && (
                  <button
                    onClick={() => deleteStation(s.number)}
                    className="text-xs text-fofRed underline"
                  >
                    Delete
                  </button>
                )}
              </li>
            ))}
            {stationRows.length === 0 && (
              <li className="text-sm text-fofGunmetal">No stations yet - add the first one below.</li>
            )}
          </ul>
        )}

        {!reorderingStations && !editingStations && (
          <form onSubmit={addStation} className="flex flex-wrap items-end gap-3">
            <input
              value={newStationName}
              onChange={(e) => setNewStationName(e.target.value)}
              placeholder={`Station ${stationRows.length + 1} name`}
              className="tap-target flex-1 rounded border border-fofGunmetal bg-transparent px-3"
            />
            <label className="flex items-center gap-1 text-sm text-fofGunmetal">
              <input
                type="checkbox"
                checked={newStationIsRun}
                onChange={(e) => setNewStationIsRun(e.target.checked)}
              />
              This is a run, not an exercise
            </label>
            <button
              type="submit"
              disabled={addingStation}
              className="tap-target rounded btn-stamped px-4 font-display disabled:opacity-50"
            >
              {addingStation ? "Adding..." : "Add station"}
            </button>
          </form>
        )}
        {stationError && <p className="mt-2 text-sm text-fofRed">{stationError}</p>}

        {!reorderingStations && stationRows.length > 0 && (
          <div className="mt-4 border-t border-fofCharcoal pt-3">
            <p className="mb-2 text-xs uppercase tracking-wide text-fofGunmetal">
              What every team actually does, in order
            </p>
            <p className="text-sm text-fofGunmetal">
              {stationRows
                .map((s) => (s.isRun ? `${s.name} (run)` : s.name))
                .concat(["FINISH"])
                .join(" → ")}
            </p>
            <p className="mt-1 text-xs text-fofGunmetal">
              This is exactly what judges will confirm, in exactly this
              order - if a 400m run happens somewhere, add it as its own
              station wherever it belongs (nothing is added automatically).
            </p>
          </div>
        )}
      </CollapsibleSection>

      <section className="mb-10">
        <h2 className="mb-3 border-t-2 border-fofRed pt-4 font-display text-lg tracking-wide">Race day control</h2>
        <p className="mb-3 text-sm text-fofGunmetal">
          Nothing is timed until you start a heat here - the moment you do,
          every judge in that heat sees their clock start on their phone.
          A heat closes itself automatically once every team in it has
          finished; use "End heat" only if a team DNFs and will never cross
          the line.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sortedWaves.map((w) => {
            const started = !!w.actual_start;
            const ended = !!w.actual_end;
            // Read as a plain wall-clock label, not converted through the
            // browser's timezone - this has to match how every id is
            // generated (heatIdPrefix, lib/teamId.ts) or the heat card and
            // the team ids next to it will disagree by whatever offset
            // the browser's local timezone happens to be.
            const schedDate = new Date(w.scheduled_start);
            const schedMM = String(schedDate.getUTCMinutes()).padStart(2, "0");
            const schedHour12 = ((schedDate.getUTCHours() + 11) % 12) + 1;
            const schedAmPm = schedDate.getUTCHours() < 12 ? "AM" : "PM";
            const scheduled = `${schedHour12}:${schedMM} ${schedAmPm}`;
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
                    className="tap-target mt-3 w-full rounded btn-stamped font-display disabled:opacity-50"
                  >
                    {busy ? "Starting..." : `Start Heat ${w.wave_number}`}
                  </button>
                )}

                {!started && (teamCountByWave.get(w.wave_number) ?? 0) === 0 && (
                  <button
                    onClick={() => removeHeat(w.wave_number)}
                    className="mt-2 block w-full text-xs text-fofGunmetal underline"
                  >
                    Remove heat
                  </button>
                )}
                {!started && (teamCountByWave.get(w.wave_number) ?? 0) > 0 && (
                  <p className="mt-2 text-[10px] text-fofGunmetal">
                    {teamCountByWave.get(w.wave_number)} team
                    {teamCountByWave.get(w.wave_number) === 1 ? "" : "s"}
                  </p>
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

          <form
            onSubmit={addHeat}
            className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-fofCharcoal p-4 text-center"
          >
            <p className="font-display text-sm text-fofGunmetal">Add a heat</p>
            {waveList.length === 0 && (
              <input
                type="date"
                value={newHeatDate}
                onChange={(e) => setNewHeatDate(e.target.value)}
                className="rounded border border-fofGunmetal bg-transparent px-2 py-1 text-xs"
                aria-label="Event date for the first heat"
              />
            )}
            <input
              type="time"
              value={newHeatTime}
              onChange={(e) => setNewHeatTime(e.target.value)}
              className="rounded border border-fofGunmetal bg-transparent px-2 py-1 text-sm"
              aria-label="Scheduled start time for the new heat"
            />
            <button
              type="submit"
              disabled={addingHeat}
              className="tap-target w-full rounded btn-stamped font-display text-sm disabled:opacity-50"
            >
              {addingHeat ? "Adding..." : "Add heat"}
            </button>
          </form>
        </div>
        {heatStatus && <p className="mt-2 text-sm text-fofRed">{heatStatus}</p>}
      </section>

      <LiveMonitor />

      <section className="mb-10 overflow-x-auto">
        <h2 className="mb-3 border-t-2 border-fofRed pt-4 font-display text-lg tracking-wide">Teams</h2>

        <form
          onSubmit={addTeam}
          className="mb-4 flex flex-wrap items-end gap-2 rounded border border-fofCharcoal p-3 text-sm"
        >
          <div>
            <label className="mb-1 block text-xs text-fofGunmetal">Team name</label>
            <input
              value={newTeam.team_name}
              onChange={(e) => setNewTeam((p) => ({ ...p, team_name: e.target.value }))}
              className="rounded border border-fofGunmetal bg-transparent px-2 py-1"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-fofGunmetal">Athlete 1</label>
            <input
              value={newTeam.athlete_1}
              onChange={(e) => setNewTeam((p) => ({ ...p, athlete_1: e.target.value }))}
              className="rounded border border-fofGunmetal bg-transparent px-2 py-1"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-fofGunmetal">Athlete 2</label>
            <input
              value={newTeam.athlete_2}
              onChange={(e) => setNewTeam((p) => ({ ...p, athlete_2: e.target.value }))}
              className="rounded border border-fofGunmetal bg-transparent px-2 py-1"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-fofGunmetal">Division</label>
            <select
              value={newTeam.division}
              onChange={(e) => setNewTeam((p) => ({ ...p, division: e.target.value }))}
              className="rounded border border-fofGunmetal bg-transparent px-2 py-1"
            >
              <option value="" className="bg-fofBlack">
                -
              </option>
              <option value="Men" className="bg-fofBlack">Men</option>
              <option value="Women" className="bg-fofBlack">Women</option>
              <option value="Mixed" className="bg-fofBlack">Mixed</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-fofGunmetal">Heat</label>
            <select
              value={newTeam.wave}
              onChange={(e) => setNewTeam((p) => ({ ...p, wave: e.target.value }))}
              className="rounded border border-fofGunmetal bg-transparent px-2 py-1"
            >
              <option value="" className="bg-fofBlack">
                Choose...
              </option>
              {sortedWaves.map((w) => (
                <option key={w.wave_number} value={w.wave_number} className="bg-fofBlack">
                  Heat {w.wave_number}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={addingTeam}
            className="tap-target rounded btn-stamped px-4 font-display disabled:opacity-50"
          >
            {addingTeam ? "Adding..." : "Add team"}
          </button>
          <span className="text-xs text-fofGunmetal">
            ID is assigned automatically (FF + heat time + position).
          </span>
          {addTeamStatus && <span className="text-xs text-fofRed">{addTeamStatus}</span>}
        </form>

        <table className="w-full min-w-[900px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-fofGunmetal text-left text-fofGunmetal">
              <th className="p-2">ID</th>
              <th className="p-2">Team Name</th>
              <th className="p-2">Athlete 1</th>
              <th className="p-2">Athlete 2</th>
              <th className="p-2">Division</th>
              <th className="p-2">Heat</th>
              <th className="p-2">Started</th>
              <th className="p-2">Viewer Login</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((team) => {
              const teamScans = scans.filter((s: any) => (s as any).team_id === team.id);
              const next = getNextAction(teamScans as Scan[], stationRows);
              const teamWave = waveList.find((w) => w.wave_number === team.wave);
              const started = hasWaveStarted(teamWave);
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
                      {team.division && !["Men", "Women", "Mixed"].includes(team.division) && (
                        <option value={team.division} className="bg-fofBlack">
                          {team.division} (unrecognized)
                        </option>
                      )}
                    </select>
                  </td>
                  <td className="p-2">
                    <select
                      value={team.wave ?? ""}
                      onChange={(e) => updateField(team.id, "wave", e.target.value)}
                      className="border-b border-transparent bg-transparent focus:border-fofRed"
                    >
                      <option value="" className="bg-fofBlack">
                        -
                      </option>
                      {sortedWaves.map((w) => (
                        <option
                          key={w.wave_number}
                          value={w.wave_number}
                          className="bg-fofBlack"
                        >
                          Heat {w.wave_number}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2">
                    {started ? (
                      <span className="text-fofPaper">
                        {next.isFinished ? "✓ Finished" : "Started"}
                      </span>
                    ) : (
                      <span className="text-fofGunmetal">Not started</span>
                    )}
                  </td>
                  <td className="p-2 text-xs">
                    {hasViewer ? (
                      editingViewerFor === team.id ? (
                        <div className="min-w-[180px] space-y-1">
                          {editViewerLoading ? (
                            <span className="text-fofGunmetal">Loading...</span>
                          ) : editViewerDuplicates ? (
                            <>
                              <p className="text-fofRed">
                                {editViewerDuplicates.length} logins found for this team.
                              </p>
                              <button
                                onClick={() => deleteAllViewers(team.id, editViewerDuplicates.length)}
                                className="mb-1 rounded border border-fofRed px-2 py-1 text-xs text-fofRed"
                              >
                                Delete all {editViewerDuplicates.length} and start fresh
                              </button>
                              <p className="text-fofGunmetal">...or delete just the wrong one(s):</p>
                              {editViewerDuplicates.map((v) => (
                                <div key={v.id} className="flex items-center justify-between gap-2">
                                  <span className="text-fofPaper">{v.username}</span>
                                  <button
                                    onClick={() => deleteDuplicateViewer(team.id, v.id)}
                                    className="text-fofRed underline"
                                  >
                                    Delete
                                  </button>
                                </div>
                              ))}
                              <button
                                onClick={() => setEditingViewerFor(null)}
                                className="text-xs text-fofGunmetal underline"
                              >
                                Cancel
                              </button>
                              {editViewerStatus && (
                                <p className="text-xs text-fofGunmetal">{editViewerStatus}</p>
                              )}
                            </>
                          ) : (
                            <>
                              <input
                                value={editViewerUsername}
                                onChange={(e) => setEditViewerUsername(e.target.value)}
                                placeholder="Username"
                                className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-2 py-1 text-xs"
                              />
                              <input
                                type="password"
                                value={editViewerPassword}
                                onChange={(e) => setEditViewerPassword(e.target.value)}
                                placeholder="New password (optional)"
                                className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-2 py-1 text-xs"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={() => saveEditViewer(team.id)}
                                  disabled={editViewerSaving}
                                  className="rounded border border-fofGunmetal px-2 py-1 text-xs hover:border-fofRed hover:text-fofRed disabled:opacity-50"
                                >
                                  {editViewerSaving ? "Saving..." : "Save"}
                                </button>
                                <button
                                  onClick={() => setEditingViewerFor(null)}
                                  className="text-xs text-fofGunmetal underline"
                                >
                                  Cancel
                                </button>
                              </div>
                              {editViewerStatus && (
                                <p className="text-xs text-fofGunmetal">{editViewerStatus}</p>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="text-fofGunmetal">✓ set up</span>
                          <button
                            onClick={() => startEditViewer(team.id)}
                            className="text-fofGunmetal underline"
                          >
                            Edit
                          </button>
                        </span>
                      )
                    ) : (
                      <span className="text-fofRed">none yet</span>
                    )}
                  </td>
                  <td className="p-2">
                    <div className="flex gap-2">
                      <button
                        onClick={() => saveRow(team)}
                        disabled={savingId === team.id}
                        className="rounded border border-fofRed px-2 py-1 text-fofRed disabled:opacity-50"
                      >
                        {savingId === team.id ? "Saving..." : "Save"}
                      </button>
                      <button
                        onClick={() => deleteTeam(team)}
                        className="rounded border border-fofGunmetal px-2 py-1 text-fofGunmetal hover:border-fofRed hover:text-fofRed"
                        aria-label={`Delete ${team.id}`}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="mb-10 grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="mb-3 border-t-2 border-fofRed pt-4 font-display text-lg tracking-wide">Create a judge login</h2>
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
                  {t.id} - {t.team_name}
                </label>
              ))}
            </div>
            <button
              type="submit"
              disabled={creatingJudge}
              className="tap-target w-full rounded btn-stamped font-display disabled:opacity-50"
            >
              {creatingJudge ? "Creating..." : "Create judge login"}
            </button>
            {judgeCreateStatus && (
              <p className="text-sm text-fofGunmetal">{judgeCreateStatus}</p>
            )}
          </form>
        </div>

        <div>
          <h2 className="mb-3 border-t-2 border-fofRed pt-4 font-display text-lg tracking-wide">Create a team login</h2>
          <form onSubmit={createViewer} className="space-y-2 rounded border border-fofCharcoal p-4">
            <select
              value={viewerTeamId}
              onChange={(e) => setViewerTeamId(e.target.value)}
              className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-3"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id} className="bg-fofBlack">
                  {t.id} - {t.team_name} {teamsWithViewer.includes(t.id) ? "(already has one)" : ""}
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
              className="tap-target w-full rounded btn-stamped font-display disabled:opacity-50"
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
        <h2 className="mb-3 border-t-2 border-fofRed pt-4 font-display text-lg tracking-wide">Judges &amp; assignments</h2>
        <div className="mb-4 flex flex-wrap items-start gap-2">
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

          <details className="rounded border border-fofGunmetal px-2 py-1">
            <summary className="cursor-pointer select-none">
              {newTeamIds.length === 0
                ? "Select teams..."
                : `${newTeamIds.length} team${newTeamIds.length > 1 ? "s" : ""} selected`}
            </summary>
            <div className="mt-2 max-h-48 w-56 overflow-y-auto border-t border-fofCharcoal pt-2 text-sm">
              {teams.map((t) => (
                <label key={t.id} className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={newTeamIds.includes(t.id)}
                    onChange={() => toggleNewTeamId(t.id)}
                  />
                  {t.id} - {t.team_name}
                </label>
              ))}
            </div>
          </details>

          <button
            onClick={addAssignment}
            disabled={newTeamIds.length === 0}
            className="rounded border border-fofRed px-3 py-1 text-fofRed disabled:opacity-50"
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
                        <span className="text-fofGunmetal"> - no teams assigned</span>
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
                        className="tap-target rounded btn-stamped px-4 font-display disabled:opacity-50"
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
                className="tap-target rounded btn-stamped px-4 font-display disabled:opacity-50"
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
