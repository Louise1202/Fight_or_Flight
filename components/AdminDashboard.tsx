"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { formatDuration, getNextAction, Scan } from "@/lib/timing";
import { Wave, hasWaveStarted } from "@/lib/waves";
import { StationDef } from "@/lib/stations";
import { useSharedTheme } from "@/lib/useSharedTheme";
import { brandFor, EventRow, formatEventDate } from "@/lib/events";
import LiveMonitor from "./LiveMonitor";
import PasswordInput from "./PasswordInput";
import CollapsibleSection from "./CollapsibleSection";

// ---------------------------------------------------------------------
// Types shared with app/admin/page.tsx
// ---------------------------------------------------------------------

export type TeamStatus = "registered" | "confirmed" | "withdrawn";

export type AdminTeam = {
  id: string;
  team_name: string;
  athlete_1: string | null;
  athlete_2: string | null;
  division: string | null;
  wave: number | null;
  start_time: string | null;
  status: TeamStatus;
  paid: boolean;
  registered_at: string | null;
};

export type EventCard = EventRow & { teamCount: number };

type AdminWave = Wave & { end_reason?: string | null };
type Judge = { id: string; name: string; active: boolean };
type Assignment = { judge_id: string; team_id: string };
type AdminScan = Scan & { team_id: string };

type TabKey = "race" | "registrations" | "teams" | "people" | "course" | "tools";

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

const BTN =
  "tap-target rounded border border-fofGunmetal px-4 py-2 text-sm font-display hover:border-fofRed hover:text-fofRed disabled:opacity-50";
const BTN_SMALL =
  "rounded border border-fofGunmetal px-3 py-2 text-sm hover:border-fofRed hover:text-fofRed disabled:opacity-50";
const BTN_PRIMARY = "tap-target rounded btn-stamped px-4 font-display disabled:opacity-50";
const INPUT = "tap-target w-full rounded border border-fofGunmetal bg-transparent px-3";
const H2 = "mb-3 border-t-2 border-fofRed pt-4 font-display text-lg tracking-wide";
const PILL = "inline-block rounded border px-2 py-0.5 text-[10px] font-display uppercase tracking-wide";

type ApiResult = { ok: boolean; status: number; data: any };

async function callApi(url: string, method: string, body?: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: "Couldn't reach the server - check your connection." } };
  }
}

function errorOf(r: ApiResult, fallback: string): string {
  return typeof r.data?.error === "string" ? r.data.error : fallback;
}

// Scheduled heat times are stored as a plain wall-clock time with no
// timezone (see lib/teamId.ts) - read with getUTC*, never converted.
function wallClock(iso: string): string {
  const d = new Date(iso);
  const hour12 = ((d.getUTCHours() + 11) % 12) + 1;
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hour12}:${mm} ${d.getUTCHours() < 12 ? "AM" : "PM"}`;
}

function wallHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// Real moments (a heat actually starting/ending, a sign-up) are shown in
// South African time, whatever timezone the admin's device is set to.
const SAST_HMS = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const SAST_HM = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const SAST_DATE_TIME = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function sast(iso: string | null | undefined, fmt: Intl.DateTimeFormat): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : fmt.format(d);
}

function eventStatusLabel(e: EventRow): { label: string; strong: boolean } {
  if (e.locked) return { label: "Finished · Locked", strong: false };
  if (e.status === "finished") return { label: "Finished", strong: false };
  if (e.status === "live") return { label: "Live", strong: true };
  if (e.registration_open) return { label: "Registration open", strong: true };
  return { label: "Setting up", strong: false };
}

function endReasonLabel(r: string | null | undefined): string {
  if (r === "all_finished") return "everyone finished";
  if (r === "time_limit") return "time limit reached";
  if (r === "manual") return "ended by hand";
  return "";
}

const TAB_KEYS: TabKey[] = ["race", "registrations", "teams", "people", "course", "tools"];

// =====================================================================
// Main dashboard
// =====================================================================

export default function AdminDashboard({
  event,
  events,
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
  event: EventRow;
  events: EventCard[];
  teams: AdminTeam[];
  judges: Judge[];
  assignments: Assignment[];
  scans: AdminScan[];
  teamsWithViewer: string[];
  waves: AdminWave[];
  initialTheme: "dark" | "light";
  stations: StationDef[];
  orphanedTeams: { id: string; team_name: string }[];
  duplicateTeamNames: { name: string; wave: number; count: number }[];
}) {
  const brand = brandFor(event);
  const readOnly = event.locked;

  // --- Shared light/dark theme ---
  const syncedTheme = useSharedTheme(initialTheme);
  const [themeOverride, setThemeOverride] = useState<"dark" | "light" | null>(null);
  const theme = themeOverride ?? syncedTheme;
  const [togglingTheme, setTogglingTheme] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);

  // Once the shared value catches up with the local click, trust it again.
  useEffect(() => {
    if (themeOverride && syncedTheme === themeOverride) setThemeOverride(null);
  }, [syncedTheme, themeOverride]);

  async function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setThemeOverride(next);
    setThemeError(null);
    setTogglingTheme(true);
    const r = await callApi("/api/admin/settings/theme", "PATCH", { theme: next });
    if (!r.ok) {
      setThemeError(errorOf(r, "Couldn't save - try again."));
      setThemeOverride(null);
    }
    setTogglingTheme(false);
  }

  // --- State shared between tabs ---
  const [rows, setRows] = useState<AdminTeam[]>(teams);
  const [waveList, setWaveList] = useState<AdminWave[]>(waves);
  const [judgeList, setJudgeList] = useState<Judge[]>(judges);
  const [assignmentList, setAssignmentList] = useState<Assignment[]>(assignments);

  const sortedWaves = useMemo(
    () =>
      [...waveList].sort(
        (a, b) =>
          new Date(a.scheduled_start).getTime() - new Date(b.scheduled_start).getTime() ||
          a.wave_number - b.wave_number
      ),
    [waveList]
  );

  const scansByTeam = useMemo(() => {
    const m = new Map<string, AdminScan[]>();
    for (const s of scans) {
      const list = m.get(s.team_id) ?? [];
      list.push(s);
      m.set(s.team_id, list);
    }
    return m;
  }, [scans]);

  function patchTeamLocally(id: string, patch: Partial<AdminTeam>) {
    setRows((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  // --- Tabs (remembered in the address bar so a reload stays put) ---
  const defaultTab: TabKey = event.registration_open && !readOnly ? "registrations" : "race";
  const [tab, setTab] = useState<TabKey>(defaultTab);
  useEffect(() => {
    const h = window.location.hash.replace("#", "") as TabKey;
    if (TAB_KEYS.includes(h)) setTab(h);
  }, []);
  function chooseTab(t: TabKey) {
    setTab(t);
    try {
      window.history.replaceState(null, "", `#${t}`);
    } catch {
      /* ignore */
    }
  }

  const activeCount = rows.filter((t) => t.status !== "withdrawn").length;
  const tabs: { key: TabKey; label: string }[] = [
    ...(event.registration_open ? [{ key: "registrations" as TabKey, label: "Registrations" }] : []),
    { key: "race", label: "Race day" },
    ...(!event.registration_open ? [{ key: "registrations" as TabKey, label: "Registrations" }] : []),
    { key: "teams", label: `Teams & heats (${activeCount})` },
    { key: "people", label: "Judges & logins" },
    { key: "course", label: "Course" },
    { key: "tools", label: "Event tools" },
  ];

  return (
    <main
      data-theme={theme}
      data-brand={event.theme}
      className="ground min-h-screen overflow-x-hidden bg-fofBlack text-fofPaper mx-auto max-w-6xl px-4 py-8"
    >
      <header className="mb-4 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={brand.logo}
          alt=""
          className={`h-12 w-12 shrink-0 object-contain ${brand.logoRound ? "logo-round" : ""}`}
        />
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-fofRed">RACE HQ - ADMIN</h1>
          <p className="truncate text-sm text-fofGunmetal">
            <span className="text-fofPaper">{event.name}</span> · {formatEventDate(event.event_date)}
            {event.venue ? ` · ${event.venue}` : ""}
          </p>
        </div>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button onClick={toggleTheme} disabled={togglingTheme} className={BTN_SMALL}>
          {theme === "dark" ? "☀ Light mode" : "☾ Dark mode"}
        </button>
        <a href="/leaderboard" target="_blank" rel="noopener noreferrer" className={BTN_SMALL}>
          Leaderboard
        </a>
        <a href="/screen" target="_blank" rel="noopener noreferrer" className={BTN_SMALL}>
          Big screen
        </a>
        <a href={`/api/admin/export?eventId=${encodeURIComponent(event.id)}`} className={BTN_SMALL}>
          Export to Excel
        </a>
        <a href="/api/admin/team-logins-report" className={BTN_SMALL}>
          Team Logins
        </a>
        <a href="/admin/qr-codes" className={BTN_SMALL}>
          Print QR codes
        </a>
        <button
          onClick={async (e) => {
            const btn = e.currentTarget;
            btn.setAttribute("aria-busy", "true");
            btn.textContent = "Signing out...";
            await fetch("/api/admin/logout", { method: "POST" }).catch(() => null);
            window.location.href = "/admin/login";
          }}
          className={`${BTN_SMALL} text-fofGunmetal`}
        >
          Sign out
        </button>
        {themeError && <span className="text-xs text-fofRed">{themeError}</span>}
      </div>

      {readOnly && (
        <div role="status" className="mb-6 rounded border-2 border-fofRed bg-fofPanel p-4 text-sm">
          <p className="font-display text-fofRed">This event is finished and locked. Its results can&apos;t be changed.</p>
          <p className="mt-1 text-fofGunmetal">
            You can still watch the live monitor, view the results and download the spreadsheets. To work on
            another event, make it active below.
          </p>
        </div>
      )}

      <EventsPanel event={event} events={events} hasTeams={rows.length > 0} />

      <nav aria-label="Admin sections" className="mb-6 -mx-4 overflow-x-auto px-4">
        <div className="flex min-w-max gap-1 border-b border-fofCharcoal">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => chooseTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`tap-target whitespace-nowrap rounded-t border-b-2 px-4 py-2 text-sm font-display ${
                tab === t.key
                  ? "border-fofRed text-fofRed"
                  : "border-transparent text-fofGunmetal hover:text-fofPaper"
              }`}
            >
              {t.label}
              {t.key === "registrations" && event.registration_open && (
                <span className="ml-2 inline-block h-2 w-2 rounded-full bg-fofRed align-middle" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      </nav>

      {tab === "race" && (
        <RaceDayTab
          event={event}
          readOnly={readOnly}
          rows={rows}
          setRows={setRows}
          waveList={waveList}
          setWaveList={setWaveList}
          sortedWaves={sortedWaves}
          scansByTeam={scansByTeam}
        />
      )}

      {tab === "registrations" && (
        <RegistrationsTab
          event={event}
          readOnly={readOnly}
          sortedWaves={sortedWaves}
          onTeamChanged={patchTeamLocally}
        />
      )}

      {tab === "teams" && (
        <TeamsTab
          event={event}
          readOnly={readOnly}
          rows={rows}
          setRows={setRows}
          waveList={waveList}
          sortedWaves={sortedWaves}
          scansByTeam={scansByTeam}
          stations={stations}
          teamsWithViewer={teamsWithViewer}
          setAssignmentList={setAssignmentList}
          orphanedTeams={orphanedTeams}
          duplicateTeamNames={duplicateTeamNames}
        />
      )}

      {tab === "people" && (
        <PeopleTab
          readOnly={readOnly}
          rows={rows}
          judgeList={judgeList}
          setJudgeList={setJudgeList}
          assignmentList={assignmentList}
          setAssignmentList={setAssignmentList}
          teamsWithViewer={teamsWithViewer}
        />
      )}

      {tab === "course" && <CourseTab readOnly={readOnly} stations={stations} eventHasScans={scans.length > 0} />}

      {tab === "tools" && <ToolsTab event={event} readOnly={readOnly} />}
    </main>
  );
}

// =====================================================================
// Events panel
// =====================================================================

function EventsPanel({ event, events, hasTeams }: { event: EventRow; events: EventCard[]; hasTeams: boolean }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const signupUrl = `${origin}/register/${event.id}`;
  const canSignUp = event.team_id_scheme === "sequential" && !event.locked;

  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"settings" | "new" | "lock" | "qr" | null>(null);

  function openPanel(p: typeof panel) {
    setPanel((cur) => (cur === p ? null : p));
    setMessage(null);
    setError(null);
  }

  // --- Make active ---
  async function makeActive(e: EventCard) {
    if (
      !window.confirm(
        `Make "${e.name}" the active event?\n\nThis screen, the judges' phones, the live monitor and the public leaderboard will all switch to it.`
      )
    )
      return;
    setBusy(e.id);
    setError(null);
    const r = await callApi(`/api/admin/events/${encodeURIComponent(e.id)}/activate`, "POST");
    if (!r.ok) {
      setBusy(null);
      setError(errorOf(r, "Couldn't switch the active event."));
      return;
    }
    window.location.hash = "";
    window.location.reload();
  }

  // --- Copy sign-up link ---
  async function copySignupLink() {
    setError(null);
    try {
      await navigator.clipboard.writeText(signupUrl);
      setMessage("Sign-up link copied. Paste it into WhatsApp, Instagram or an email.");
    } catch {
      setMessage(`Copy this link: ${signupUrl}`);
    }
  }

  // --- Sign-up QR ---
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  async function showSignupQr() {
    if (panel === "qr") {
      setPanel(null);
      return;
    }
    openPanel("qr");
    try {
      const url = await QRCode.toDataURL(signupUrl, {
        width: 600,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
      setQrUrl(url);
    } catch {
      setError("Couldn't make the QR code - try again.");
    }
  }

  // --- Event settings ---
  const [s, setS] = useState({
    name: event.name,
    event_date: event.event_date,
    venue: event.venue ?? "",
    registration_time: event.registration_time ?? "",
    heat_minutes: String(event.heat_minutes),
    entry_fee: event.entry_fee ?? "",
    bank_details: event.bank_details ?? "",
    registration_open: event.registration_open,
    team_id_prefix: event.team_id_prefix,
  });

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const minutes = Number(s.heat_minutes);
    if (!Number.isInteger(minutes) || minutes < 10 || minutes > 240) {
      setError("Heat length must be between 10 and 240 minutes.");
      return;
    }
    const body: Record<string, unknown> = {
      name: s.name,
      event_date: s.event_date,
      venue: s.venue,
      registration_time: s.registration_time,
      heat_minutes: minutes,
      entry_fee: s.entry_fee,
      bank_details: s.bank_details,
    };
    if (event.team_id_scheme === "sequential") body.registration_open = s.registration_open;
    if (!hasTeams) body.team_id_prefix = s.team_id_prefix;
    setBusy("settings");
    const r = await callApi(`/api/admin/events/${encodeURIComponent(event.id)}`, "PATCH", body);
    setBusy(null);
    if (!r.ok) {
      setError(errorOf(r, "Couldn't save the event settings."));
      return;
    }
    setMessage("Saved. Reloading...");
    window.location.reload();
  }

  // --- New event ---
  const [n, setN] = useState({
    name: "",
    event_date: "",
    venue: "",
    theme: "survivor" as "fof" | "survivor",
    team_id_prefix: "",
    copy_stations_from: "",
  });

  async function createEvent(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (n.name.trim().length < 2) return setError("Give the event a name.");
    if (!n.event_date) return setError("Choose the event date.");
    if (!/^[A-Z]{2,4}$/.test(n.team_id_prefix)) return setError("Team ID letters must be 2 to 4 capital letters, e.g. SV.");
    setBusy("new");
    const r = await callApi("/api/admin/events", "POST", {
      ...n,
      copy_stations_from: n.copy_stations_from || null,
    });
    setBusy(null);
    if (!r.ok) {
      setError(errorOf(r, "Couldn't create the event."));
      return;
    }
    setMessage(
      `${r.data.event?.name ?? "Event"} created.${r.data.warning ? ` ${r.data.warning}` : ""} Press "Make active" on it when you're ready to work on it.`
    );
    window.setTimeout(() => window.location.reload(), 2500);
  }

  // --- Finish & lock ---
  const [lockText, setLockText] = useState("");
  async function lockEvent() {
    if (lockText !== "LOCK") return;
    setBusy("lock");
    setError(null);
    const r = await callApi(`/api/admin/events/${encodeURIComponent(event.id)}/lock`, "POST", { confirm: "LOCK" });
    setBusy(null);
    if (!r.ok) {
      setError(errorOf(r, "Couldn't lock the event."));
      return;
    }
    setMessage("Locked. Reloading...");
    window.location.reload();
  }

  return (
    <CollapsibleSection title="Events" defaultOpen={true}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((e) => {
          const active = e.id === event.id;
          const st = eventStatusLabel(e);
          const finished = e.locked || e.status === "finished";
          return (
            <div
              key={e.id}
              className={`min-w-0 rounded border p-3 ${active ? "border-fofRed bg-fofPanel" : "border-fofCharcoal"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words font-display text-base">{e.name}</p>
                {active && <span className={`${PILL} shrink-0 border-fofRed text-fofRed`}>Active</span>}
              </div>
              <p className="text-xs text-fofGunmetal">
                {formatEventDate(e.event_date)}
                {e.venue ? ` · ${e.venue}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`${PILL} ${st.strong ? "border-fofRed text-fofRed" : "border-fofGunmetal text-fofGunmetal"}`}
                >
                  {st.label}
                </span>
                <span className="text-xs text-fofGunmetal">
                  {e.teamCount} team{e.teamCount === 1 ? "" : "s"} · IDs {e.team_id_prefix}
                  {e.team_id_scheme === "sequential" ? "001..." : "+heat time"}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {!active && (
                  <button onClick={() => makeActive(e)} disabled={busy === e.id} className={BTN_SMALL}>
                    {busy === e.id ? "Switching..." : "Make active"}
                  </button>
                )}
                {active && !e.locked && (
                  <>
                    <button onClick={() => openPanel("settings")} className={BTN_SMALL}>
                      Event settings
                    </button>
                    {canSignUp && (
                      <>
                        <button onClick={copySignupLink} disabled={!origin} className={BTN_SMALL}>
                          Copy sign-up link
                        </button>
                        <button onClick={showSignupQr} disabled={!origin} className={BTN_SMALL}>
                          Sign-up QR
                        </button>
                      </>
                    )}
                    <button onClick={() => openPanel("lock")} className={`${BTN_SMALL} text-fofRed`}>
                      Finish &amp; lock
                    </button>
                  </>
                )}
                {finished && (
                  <>
                    <a href={`/results/${encodeURIComponent(e.id)}`} target="_blank" rel="noopener noreferrer" className={BTN_SMALL}>
                      View results
                    </a>
                    <a href={`/api/admin/export?eventId=${encodeURIComponent(e.id)}`} className={BTN_SMALL}>
                      Download Excel
                    </a>
                  </>
                )}
              </div>
            </div>
          );
        })}

        <button
          onClick={() => openPanel("new")}
          className="tap-target flex min-h-[120px] flex-col items-center justify-center rounded border border-dashed border-fofCharcoal p-3 text-center font-display text-sm text-fofGunmetal hover:border-fofRed hover:text-fofRed"
        >
          + New event
        </button>
      </div>

      {message && <p className="mt-3 break-words text-sm text-fofPaper">{message}</p>}
      {error && <p className="mt-3 text-sm text-fofRed">{error}</p>}

      {panel === "qr" && (
        <div className="mt-4 rounded border border-fofCharcoal p-4 text-center">
          <p className="mb-2 font-display">Sign-up QR for {event.name}</p>
          {!event.registration_open && (
            <p className="mb-2 text-xs text-fofRed">
              Registration is closed right now - people who scan this will be told so. Open it in Event settings.
            </p>
          )}
          {qrUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrUrl} alt={`QR code for the ${event.name} sign-up page`} className="mx-auto w-full max-w-[280px] bg-white p-2" />
          ) : (
            <div className="mx-auto aspect-square w-full max-w-[280px] animate-pulse bg-fofCharcoal" />
          )}
          <p className="mt-2 break-all font-mono text-xs text-fofGunmetal">{signupUrl}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {qrUrl && (
              <a href={qrUrl} download={`signup-qr-${event.id}.png`} className={BTN_SMALL}>
                Save QR image
              </a>
            )}
            <button onClick={() => setPanel(null)} className={`${BTN_SMALL} text-fofGunmetal`}>
              Close
            </button>
          </div>
        </div>
      )}

      {panel === "settings" && (
        <form onSubmit={saveSettings} className="mt-4 grid gap-3 rounded border border-fofCharcoal p-4 sm:grid-cols-2">
          <p className="font-display sm:col-span-2">Event settings - {event.name}</p>
          <Field label="Event name">
            <input value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} maxLength={80} required className={INPUT} />
          </Field>
          <Field label="Date">
            <input type="date" value={s.event_date} onChange={(e) => setS({ ...s, event_date: e.target.value })} required className={INPUT} />
          </Field>
          <Field label="Venue">
            <input value={s.venue} onChange={(e) => setS({ ...s, venue: e.target.value })} maxLength={120} className={INPUT} />
          </Field>
          <Field label="Registration time (shown as typed, e.g. 06:00)">
            <input value={s.registration_time} onChange={(e) => setS({ ...s, registration_time: e.target.value })} maxLength={40} className={INPUT} />
          </Field>
          <Field label="Heat length (minutes)">
            <input
              type="number"
              inputMode="numeric"
              min={10}
              max={240}
              value={s.heat_minutes}
              onChange={(e) => setS({ ...s, heat_minutes: e.target.value })}
              className={INPUT}
            />
          </Field>
          <Field label="Entry fee (shown on the sign-up page, e.g. R400 per team)">
            <input value={s.entry_fee} onChange={(e) => setS({ ...s, entry_fee: e.target.value })} maxLength={200} className={INPUT} />
          </Field>
          <Field label="Bank details for payment" wide>
            <textarea
              value={s.bank_details}
              onChange={(e) => setS({ ...s, bank_details: e.target.value })}
              rows={4}
              maxLength={1000}
              className="w-full rounded border border-fofGunmetal bg-transparent px-3 py-2"
            />
          </Field>
          <Field label="Team ID letters">
            <input
              value={s.team_id_prefix}
              onChange={(e) => setS({ ...s, team_id_prefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) })}
              disabled={hasTeams}
              className={`${INPUT} font-mono disabled:opacity-50`}
            />
            <span className="mt-1 block text-xs text-fofGunmetal">
              {hasTeams
                ? "Can't change any more - this event already has teams."
                : `Teams will be ${s.team_id_prefix || "XX"}001, ${s.team_id_prefix || "XX"}002 ...`}
            </span>
          </Field>
          {event.team_id_scheme === "sequential" && (
            <label className="flex items-center gap-3 self-end rounded border border-fofCharcoal p-3 text-sm">
              <input
                type="checkbox"
                checked={s.registration_open}
                onChange={(e) => setS({ ...s, registration_open: e.target.checked })}
                className="h-5 w-5"
              />
              <span>
                <span className="font-display">Registration open</span>
                <span className="block text-xs text-fofGunmetal">Teams can sign themselves up with the link.</span>
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={busy === "settings"} className={BTN_PRIMARY}>
              {busy === "settings" ? "Saving..." : "Save settings"}
            </button>
            <button type="button" onClick={() => setPanel(null)} className={`${BTN} text-fofGunmetal`}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {panel === "new" && (
        <form onSubmit={createEvent} className="mt-4 grid gap-3 rounded border border-fofCharcoal p-4 sm:grid-cols-2">
          <p className="font-display sm:col-span-2">New event</p>
          <p className="text-xs text-fofGunmetal sm:col-span-2">
            Creates the event only - no teams and no heats. It doesn&apos;t become active until you press
            &quot;Make active&quot;.
          </p>
          <Field label="Event name">
            <input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} maxLength={80} required className={INPUT} />
          </Field>
          <Field label="Date">
            <input type="date" value={n.event_date} onChange={(e) => setN({ ...n, event_date: e.target.value })} required className={INPUT} />
          </Field>
          <Field label="Venue">
            <input value={n.venue} onChange={(e) => setN({ ...n, venue: e.target.value })} maxLength={120} className={INPUT} />
          </Field>
          <Field label="Look">
            <select
              value={n.theme}
              onChange={(e) => setN({ ...n, theme: e.target.value === "fof" ? "fof" : "survivor" })}
              className={INPUT}
            >
              <option value="survivor" className="bg-fofBlack">Survivor (blue)</option>
              <option value="fof" className="bg-fofBlack">Fight or Flight (red)</option>
            </select>
          </Field>
          <Field label="Team ID letters (2 to 4 capitals)">
            <input
              value={n.team_id_prefix}
              onChange={(e) => setN({ ...n, team_id_prefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) })}
              placeholder="e.g. SV"
              required
              className={`${INPUT} font-mono`}
            />
            <span className="mt-1 block text-xs text-fofGunmetal">
              Teams will be {n.team_id_prefix || "XX"}001, {n.team_id_prefix || "XX"}002 ... and keep that ID for good.
            </span>
          </Field>
          <Field label="Copy the stations from">
            <select value={n.copy_stations_from} onChange={(e) => setN({ ...n, copy_stations_from: e.target.value })} className={INPUT}>
              <option value="" className="bg-fofBlack">Don&apos;t copy - start empty</option>
              {events.map((e) => (
                <option key={e.id} value={e.id} className="bg-fofBlack">
                  {e.name} ({formatEventDate(e.event_date)})
                </option>
              ))}
            </select>
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={busy === "new"} className={BTN_PRIMARY}>
              {busy === "new" ? "Creating..." : "Create event"}
            </button>
            <button type="button" onClick={() => setPanel(null)} className={`${BTN} text-fofGunmetal`}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {panel === "lock" && (
        <div className="mt-4 rounded border-2 border-fofRed p-4">
          <p className="mb-2 font-display text-fofRed">Finish &amp; lock {event.name}</p>
          <p className="mb-2 text-sm">
            This marks the event as finished and locks it. After that nobody - not you, not the judges - can change
            its teams, heats, stations, scans or penalties. Results stay visible and can still be downloaded.
          </p>
          <p className="mb-3 text-sm text-fofRed">This can&apos;t be undone from the app.</p>
          <p className="mb-2 text-sm text-fofGunmetal">
            Type <span className="font-mono text-fofRed">LOCK</span> to confirm:
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={lockText}
              onChange={(e) => setLockText(e.target.value)}
              autoCapitalize="characters"
              className="tap-target min-w-0 flex-1 rounded border border-fofGunmetal bg-transparent px-3"
            />
            <button onClick={lockEvent} disabled={lockText !== "LOCK" || busy === "lock"} className={BTN_PRIMARY}>
              {busy === "lock" ? "Locking..." : "Finish & lock"}
            </button>
            <button onClick={() => setPanel(null)} className={`${BTN} text-fofGunmetal`}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </CollapsibleSection>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block min-w-0 text-sm ${wide ? "sm:col-span-2" : ""}`}>
      <span className="mb-1 block text-xs text-fofGunmetal">{label}</span>
      {children}
    </label>
  );
}

// =====================================================================
// Race day: heat control + live monitor
// =====================================================================

function RaceDayTab({
  event,
  readOnly,
  rows,
  setRows,
  waveList,
  setWaveList,
  sortedWaves,
  scansByTeam,
}: {
  event: EventRow;
  readOnly: boolean;
  rows: AdminTeam[];
  setRows: React.Dispatch<React.SetStateAction<AdminTeam[]>>;
  waveList: AdminWave[];
  setWaveList: React.Dispatch<React.SetStateAction<AdminWave[]>>;
  sortedWaves: AdminWave[];
  scansByTeam: Map<string, AdminScan[]>;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const [waveActionId, setWaveActionId] = useState<number | null>(null);
  const [heatStatus, setHeatStatus] = useState<string | null>(null);

  const teamCountByWave = new Map<number, number>();
  for (const t of rows) {
    if (t.wave != null && t.status !== "withdrawn") teamCountByWave.set(t.wave, (teamCountByWave.get(t.wave) ?? 0) + 1);
  }

  function replaceWave(w: AdminWave | null | undefined) {
    if (!w) return;
    setWaveList((prev) => prev.map((x) => (x.wave_number === w.wave_number ? { ...x, ...w } : x)));
  }

  function heatHasScans(waveNumber: number): boolean {
    return rows.some((t) => t.wave === waveNumber && (scansByTeam.get(t.id)?.length ?? 0) > 0);
  }

  async function startHeat(waveNumber: number) {
    setWaveActionId(waveNumber);
    setHeatStatus(null);
    const r = await callApi("/api/admin/waves", "POST", { waveNumber });
    setWaveActionId(null);
    if (r.ok) return replaceWave(r.data.wave);
    if (r.status === 409 && r.data?.wave) {
      // Someone (or a double tap) already started it - show the real start.
      replaceWave(r.data.wave);
      setHeatStatus(`Heat ${waveNumber} was already started - its clock was not restarted.`);
      return;
    }
    setHeatStatus(errorOf(r, "Couldn't start the heat."));
  }

  async function endHeat(waveNumber: number) {
    if (!window.confirm(`End Heat ${waveNumber} now?\n\nJudges won't be able to record any more scans for this heat.`)) return;
    setWaveActionId(waveNumber);
    setHeatStatus(null);
    const r = await callApi("/api/admin/waves", "PATCH", { waveNumber });
    setWaveActionId(null);
    if (r.ok) return replaceWave(r.data.wave);
    if (r.data?.wave) replaceWave(r.data.wave);
    setHeatStatus(errorOf(r, "Couldn't end the heat."));
  }

  async function undoHeat(waveNumber: number, field: "start" | "end") {
    if (field === "start") {
      if (heatHasScans(waveNumber)) {
        window.alert(`Teams in Heat ${waveNumber} already have scans recorded, so the start can't be undone.`);
        return;
      }
      if (!window.confirm(`Undo the start of Heat ${waveNumber}? Its clock goes back to "not started".`)) return;
    } else if (!window.confirm(`Reopen Heat ${waveNumber}? Judges will be able to scan again.`)) {
      return;
    }
    setWaveActionId(waveNumber);
    setHeatStatus(null);
    const r = await callApi("/api/admin/waves", "DELETE", { waveNumber, field });
    setWaveActionId(null);
    if (r.ok) return replaceWave(r.data.wave);
    setHeatStatus(errorOf(r, "Couldn't undo that."));
  }

  // --- Scheduled time ---
  const [editingScheduleFor, setEditingScheduleFor] = useState<number | null>(null);
  const [scheduleTimeInput, setScheduleTimeInput] = useState("");
  const [scheduleSaving, setScheduleSaving] = useState(false);

  async function saveSchedule(waveNumber: number) {
    setScheduleSaving(true);
    const r = await callApi("/api/admin/waves", "PUT", { waveNumber, time: scheduleTimeInput });
    setScheduleSaving(false);
    if (!r.ok) {
      window.alert(errorOf(r, "Couldn't save the new time."));
      return;
    }
    setEditingScheduleFor(null);
    if (event.team_id_scheme === "heat_position") {
      // Team ids contain the heat time and may have changed.
      window.location.reload();
      return;
    }
    const sched = r.data.scheduled_start as string;
    setWaveList((prev) => prev.map((w) => (w.wave_number === waveNumber ? { ...w, scheduled_start: sched } : w)));
    setRows((prev) => prev.map((t) => (t.wave === waveNumber ? { ...t, start_time: sched } : t)));
  }

  // --- Add / remove heats ---
  const [newHeatTime, setNewHeatTime] = useState("");
  const [addingHeat, setAddingHeat] = useState(false);

  async function addHeat(e: React.FormEvent) {
    e.preventDefault();
    setHeatStatus(null);
    if (!/^\d{2}:\d{2}$/.test(newHeatTime)) {
      setHeatStatus("Enter a start time first.");
      return;
    }
    setAddingHeat(true);
    const r = await callApi("/api/admin/heats", "POST", { time: newHeatTime });
    setAddingHeat(false);
    if (!r.ok) {
      setHeatStatus(errorOf(r, "Couldn't add the heat."));
      return;
    }
    setWaveList((prev) => [...prev, r.data.wave]);
    setNewHeatTime("");
  }

  async function removeHeat(waveNumber: number) {
    if (!window.confirm(`Remove Heat ${waveNumber}?`)) return;
    // Gone from the list at once; back again if the server refuses.
    const before = waveList;
    setWaveList((prev) => prev.filter((w) => w.wave_number !== waveNumber));
    const r = await callApi("/api/admin/heats", "DELETE", { waveNumber });
    if (!r.ok) {
      setWaveList(before);
      window.alert(errorOf(r, "Couldn't remove this heat."));
    }
  }

  const noHeatCount = rows.filter((t) => t.wave == null && t.status !== "withdrawn").length;

  return (
    <>
      <section className="mb-10">
        <h2 className={H2}>Race day control</h2>
        <p className="mb-3 text-sm text-fofGunmetal">
          Nothing is timed until you start a heat here - the moment you do, every judge in that heat sees their
          clock start on their phone. A heat closes itself once every team in it has finished; use &quot;End
          heat&quot; only if a team will never cross the line. Each heat lasts {event.heat_minutes} minutes. All
          clock times are South African time.
        </p>
        {noHeatCount > 0 && (
          <p className="mb-3 text-sm text-fofRed">
            {noHeatCount} team{noHeatCount === 1 ? " has" : "s have"} no heat yet - assign them in Registrations or
            Teams &amp; heats.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {sortedWaves.map((w) => {
            const started = !!w.actual_start;
            const ended = !!w.actual_end;
            const busy = waveActionId === w.wave_number;
            const count = teamCountByWave.get(w.wave_number) ?? 0;
            return (
              <div
                key={w.wave_number}
                className={`min-w-0 rounded border p-4 text-center ${
                  ended ? "border-fofGunmetal" : started ? "border-fofRed" : "border-fofCharcoal"
                }`}
              >
                <p className="font-display text-lg">Heat {w.wave_number}</p>

                {editingScheduleFor === w.wave_number ? (
                  <div className="mt-1 flex items-center justify-center gap-2">
                    <input
                      type="time"
                      value={scheduleTimeInput}
                      onChange={(e) => setScheduleTimeInput(e.target.value)}
                      className="rounded border border-fofGunmetal bg-transparent px-1 py-0.5 text-sm"
                    />
                    <button
                      onClick={() => saveSchedule(w.wave_number)}
                      disabled={scheduleSaving}
                      className="text-xs text-fofRed underline disabled:opacity-50"
                    >
                      {scheduleSaving ? "..." : "Save"}
                    </button>
                    <button onClick={() => setEditingScheduleFor(null)} className="text-xs text-fofGunmetal underline">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-fofGunmetal">
                    Scheduled {wallClock(w.scheduled_start)}{" "}
                    {!started && !readOnly && (
                      <button
                        onClick={() => {
                          setScheduleTimeInput(wallHHMM(w.scheduled_start));
                          setEditingScheduleFor(w.wave_number);
                        }}
                        className="underline"
                        aria-label={`Edit scheduled time for Heat ${w.wave_number}`}
                      >
                        (edit)
                      </button>
                    )}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-fofGunmetal">
                  {count} team{count === 1 ? "" : "s"}
                </p>

                {!started && !readOnly && (
                  <button
                    onClick={() => startHeat(w.wave_number)}
                    disabled={busy} aria-busy={busy}
                    className="tap-target mt-3 w-full rounded btn-stamped font-display disabled:opacity-50"
                  >
                    {busy ? "Starting..." : `Start Heat ${w.wave_number}`}
                  </button>
                )}
                {!started && readOnly && <p className="mt-2 text-xs text-fofGunmetal">Never started</p>}

                {!started && !readOnly && count === 0 && (
                  <button onClick={() => removeHeat(w.wave_number)} className="mt-2 block w-full text-xs text-fofGunmetal underline">
                    Remove heat
                  </button>
                )}

                {started && !ended && (
                  <>
                    <p className="mt-2 text-sm text-fofRed">Started {sast(w.actual_start, SAST_HMS)}</p>
                    <p className="font-display text-lg">{formatDuration(now - new Date(w.actual_start!).getTime())}</p>
                    <p className="text-xs text-fofGunmetal">running</p>
                    {!readOnly && (
                      <>
                        <button
                          onClick={() => endHeat(w.wave_number)}
                          disabled={busy} aria-busy={busy}
                          className="tap-target mt-3 w-full rounded border border-fofGunmetal font-display disabled:opacity-50"
                        >
                          {busy ? "Ending..." : "End heat"}
                        </button>
                        {!heatHasScans(w.wave_number) && (
                          <button
                            onClick={() => undoHeat(w.wave_number, "start")}
                            disabled={busy} aria-busy={busy}
                            className="mt-2 text-xs text-fofGunmetal underline disabled:opacity-50"
                          >
                            Undo start (mis-click)
                          </button>
                        )}
                      </>
                    )}
                  </>
                )}

                {ended && (
                  <>
                    <p className="mt-2 text-xs text-fofGunmetal">Started {sast(w.actual_start, SAST_HM)}</p>
                    <p className="text-sm text-fofGunmetal">Finished {sast(w.actual_end, SAST_HMS)}</p>
                    {w.actual_start && (
                      <p className="font-display text-lg">
                        {formatDuration(new Date(w.actual_end!).getTime() - new Date(w.actual_start).getTime())}
                      </p>
                    )}
                    <p className="text-xs text-fofGunmetal">
                      total duration{endReasonLabel(w.end_reason) ? ` · ${endReasonLabel(w.end_reason)}` : ""}
                    </p>
                    {!readOnly && (
                      <button
                        onClick={() => undoHeat(w.wave_number, "end")}
                        disabled={busy} aria-busy={busy}
                        className="mt-2 text-xs text-fofGunmetal underline disabled:opacity-50"
                      >
                        Reopen heat
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {!readOnly && (
            <form
              onSubmit={addHeat}
              className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-fofCharcoal p-4 text-center"
            >
              <p className="font-display text-sm text-fofGunmetal">Add a heat</p>
              <p className="text-[10px] text-fofGunmetal">on {formatEventDate(event.event_date)}</p>
              <input
                type="time"
                value={newHeatTime}
                onChange={(e) => setNewHeatTime(e.target.value)}
                className="rounded border border-fofGunmetal bg-transparent px-2 py-1 text-sm"
                aria-label="Scheduled start time for the new heat"
              />
              <button type="submit" disabled={addingHeat} className="tap-target w-full rounded btn-stamped font-display text-sm disabled:opacity-50">
                {addingHeat ? "Adding..." : "Add heat"}
              </button>
            </form>
          )}
          {readOnly && waveList.length === 0 && <p className="text-sm text-fofGunmetal">No heats.</p>}
        </div>
        {heatStatus && <p className="mt-2 text-sm text-fofRed">{heatStatus}</p>}
      </section>

      <LiveMonitor />
    </>
  );
}

// =====================================================================
// Registrations
// =====================================================================

type RegMember = {
  position: number;
  first_name: string;
  surname: string;
  gender: string;
  phone: string;
  email: string;
  emergency_name: string;
  emergency_phone: string;
  emergency_relationship: string | null;
  paid?: boolean;
  paid_at?: string | null;
};

type RegTeam = {
  id: string;
  team_name: string;
  division: string | null;
  status: TeamStatus;
  paid: boolean;
  wave: number | null;
  registered_at: string | null;
  members: RegMember[];
  medicalFlags: unknown;
  signed: unknown;
};

/** medicalFlags / signed may arrive as a number, a list or a yes/no. */
function countOf(v: unknown): number {
  if (Array.isArray(v)) return v.filter(Boolean).length;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).filter(Boolean).length;
  return 0;
}

function RegistrationsTab({
  event,
  readOnly,
  sortedWaves,
  onTeamChanged,
}: {
  event: EventRow;
  readOnly: boolean;
  sortedWaves: AdminWave[];
  onTeamChanged: (id: string, patch: Partial<AdminTeam>) => void;
}) {
  const [list, setList] = useState<RegTeam[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [unpaidOnly, setUnpaidOnly] = useState(false);

  const [emailStatus, setEmailStatus] = useState<EmailStatus | null>(null);
  const [emailRowError, setEmailRowError] = useState<string | null>(null);
  const [resendingKey, setResendingKey] = useState<string | null>(null);

  async function loadEmailStatus() {
    const r = await callApi("/api/admin/results-emails", "GET");
    if (r.ok) setEmailStatus(r.data as EmailStatus);
  }

  async function resend(teamId: string, kind: "heat" | "final") {
    setResendingKey(`${teamId}:${kind}`);
    setEmailRowError(null);
    const r = await callApi("/api/admin/results-emails", "POST", { teamId, kind, resend: true });
    setResendingKey(null);
    if (!r.ok) setEmailRowError(`${teamId}: ${errorOf(r, "couldn't send the email")}`);
    loadEmailStatus();
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    loadEmailStatus();
    const r = await callApi("/api/admin/registrations", "GET");
    setLoading(false);
    if (!r.ok) {
      setLoadError(errorOf(r, "Couldn't load the registrations."));
      return;
    }
    setList(Array.isArray(r.data?.teams) ? (r.data.teams as RegTeam[]) : []);
  }

  useEffect(() => {
    load();
  }, []);

  // Changes show at once; if the server says no, the row goes back as it was.
  async function patch(team: RegTeam, body: Partial<Pick<RegTeam, "wave" | "paid" | "status">>) {
    const before = team;
    setBusyId(team.id);
    setRowError(null);
    setList((prev) => (prev ?? []).map((t) => (t.id === team.id ? { ...t, ...body } : t)));
    const r = await callApi(`/api/admin/teams/${encodeURIComponent(team.id)}`, "PATCH", body);
    setBusyId(null);
    if (!r.ok) {
      setList((prev) => (prev ?? []).map((t) => (t.id === team.id ? before : t)));
      setRowError(`${team.id}: ${errorOf(r, "couldn't save")} - nothing was changed.`);
      return;
    }
    onTeamChanged(team.id, body);
  }

  // Each athlete can pay separately; the team is paid once both have.
  // The tick shows at once; it goes back if the save fails.
  async function payMember(team: RegTeam, position: 1 | 2 | "both", paid: boolean) {
    const before = team;
    const members = team.members.map((m) =>
      position === "both" || m.position === position ? { ...m, paid, paid_at: paid ? new Date().toISOString() : null } : m
    );
    const guess = members.length ? members.every((m) => m.paid) : paid;
    setList((prev) => (prev ?? []).map((t) => (t.id !== team.id ? t : { ...t, paid: guess, members })));
    setRowError(null);
    const r = await callApi("/api/admin/registrations/payment", "PATCH", { teamId: team.id, position, paid });
    if (!r.ok) {
      setList((prev) => (prev ?? []).map((t) => (t.id === team.id ? before : t)));
      setRowError(`${team.id}: ${errorOf(r, "couldn't save the payment")} - the tick was undone.`);
      return;
    }
    const teamPaid = r.data?.teamPaid === true;
    if (teamPaid !== guess) setList((prev) => (prev ?? []).map((t) => (t.id === team.id ? { ...t, paid: teamPaid } : t)));
    onTeamChanged(team.id, { paid: teamPaid });
  }

  function teamFullyPaid(t: RegTeam): boolean {
    return t.members.length > 0 ? t.members.every((m) => m.paid) : t.paid;
  }

  function PaymentControls({ t, busy }: { t: RegTeam; busy: boolean }) {
    const members = [...t.members].sort((a, b) => a.position - b.position);
    if (members.length === 0) {
      return (
        <button
          role="switch"
          aria-checked={t.paid}
          aria-label={`Paid - ${t.id}`}
          disabled={readOnly || busy}
          onClick={() => payMember(t, "both", !t.paid)}
          className={`tap-target rounded border px-3 text-xs disabled:opacity-50 ${t.paid ? "border-fofRed text-fofRed" : "border-fofGunmetal text-fofGunmetal"}`}
        >
          {t.paid ? "✓ Paid" : "Not paid"}
        </button>
      );
    }
    const all = members.every((m) => m.paid);
    return (
      <div className="flex flex-col gap-1">
        {members.map((m) => (
          <button
            key={m.position}
            role="switch"
            aria-checked={!!m.paid}
            aria-label={`Paid - ${m.first_name} ${m.surname}, ${t.id}`}
            disabled={readOnly || busy}
            onClick={() => payMember(t, m.position as 1 | 2, !m.paid)}
            title={m.paid && m.paid_at ? `Ticked ${sast(m.paid_at, SAST_DATE_TIME)}` : undefined}
            className={`flex min-h-[40px] items-center gap-2 rounded border px-2 text-left text-xs disabled:opacity-50 ${
              m.paid ? "border-fofRed text-fofPaper" : "border-fofGunmetal text-fofGunmetal"
            }`}
          >
            <span
              aria-hidden="true"
              className={`grid h-4 w-4 shrink-0 place-items-center rounded-sm border text-[11px] leading-none ${
                m.paid ? "border-fofRed bg-fofRed text-white" : "border-fofGunmetal"
              }`}
            >
              {m.paid ? "✓" : ""}
            </span>
            <span className="truncate">{m.first_name}</span>
            <span className="ml-auto whitespace-nowrap">{m.paid ? "Paid" : "Not paid"}</span>
          </button>
        ))}
        {!readOnly && (
          <button
            disabled={busy} aria-busy={busy}
            onClick={() => payMember(t, "both", !all)}
            className="text-left text-[11px] text-fofGunmetal underline disabled:opacity-50"
          >
            {all ? "Untick both" : "Both paid together"}
          </button>
        )}
      </div>
    );
  }

  function withdraw(team: RegTeam) {
    if (
      !window.confirm(
        `Withdraw ${team.id} (${team.team_name})?\n\nThey stay on file but won't race or appear in the results. You can reinstate them later.`
      )
    )
      return;
    patch(team, { status: "withdrawn" });
  }

  /** Back in after a withdrawal: confirmed only if everyone has signed. */
  function reinstate(team: RegTeam) {
    const allSigned = team.members.length > 0 && countOf(team.signed) >= team.members.length;
    patch(team, { status: allSigned ? "confirmed" : "registered" });
  }

  function waitingToSign(t: RegTeam): boolean {
    return t.status === "registered" && t.members.length > 0 && countOf(t.signed) < t.members.length;
  }

  function statusLabel(t: RegTeam): string {
    if (t.status === "withdrawn") return "Withdrawn";
    if (t.status === "confirmed") return "Confirmed";
    return waitingToSign(t) ? `Booked · signed ${countOf(t.signed)}/${t.members.length}` : "Booked";
  }

  // Email the partner their sign link again; the link is also shown so it can be sent on WhatsApp.
  const [linkInfo, setLinkInfo] = useState<{ teamId: string; text: string; link: string | null } | null>(null);
  async function resendLink(team: RegTeam) {
    setBusyId(team.id);
    setRowError(null);
    const r = await callApi("/api/admin/registrations/partner-link", "POST", { teamId: team.id });
    setBusyId(null);
    if (!r.ok) {
      setRowError(`${team.id}: ${errorOf(r, "couldn't send the link")}`);
      return;
    }
    const partner = team.members.find((m) => m.position === 2)?.first_name ?? "The partner";
    setLinkInfo({
      teamId: team.id,
      text: r.data?.sent ? `Link emailed to ${partner} again.` : `Couldn't email ${partner} - send them the link yourself:`,
      link: typeof r.data?.link === "string" ? r.data.link : null,
    });
  }

  const teams = list ?? [];
  const live = teams.filter((t) => t.status !== "withdrawn");
  const chips = [
    { label: "Registered", value: live.length },
    { label: "Booked, waiting to sign", value: live.filter((t) => waitingToSign(t)).length, alert: true },
    { label: "Confirmed", value: live.filter((t) => t.status === "confirmed").length },
    { label: "Men", value: live.filter((t) => t.division === "Men").length },
    { label: "Women", value: live.filter((t) => t.division === "Women").length },
    { label: "Mixed", value: live.filter((t) => t.division === "Mixed").length },
    { label: "Without a heat", value: live.filter((t) => t.wave == null).length, alert: true },
    { label: "With medical notes", value: live.filter((t) => countOf(t.medicalFlags) > 0).length, alert: true },
    { label: "Withdrawn", value: teams.length - live.length },
    (() => {
      const n = live.filter((t) => teamFullyPaid(t)).length;
      return { label: n === 1 ? "team paid in full" : "teams paid in full", value: n };
    })(),
    {
      label: `of ${live.reduce((n, t) => n + Math.max(1, t.members.length), 0)} athletes paid`,
      value: live.reduce((n, t) => n + (t.members.length ? t.members.filter((m) => m.paid).length : t.paid ? 1 : 0), 0),
    },
  ];

  const q = search.trim().toLowerCase();
  const searched = q
    ? teams.filter(
        (t) =>
          t.id.toLowerCase().includes(q) ||
          (t.team_name ?? "").toLowerCase().includes(q) ||
          t.members.some((m) => `${m.first_name} ${m.surname}`.toLowerCase().includes(q))
      )
    : teams;
  const shown = unpaidOnly ? searched.filter((t) => t.status !== "withdrawn" && !teamFullyPaid(t)) : searched;

  return (
    <section className="mb-10 min-w-0">
      <h2 className={H2}>Registrations</h2>
      <p className="mb-3 text-sm text-fofGunmetal">
        {event.registration_open
          ? "Registration is open - teams are signing themselves up with the link."
          : "Registration is closed. Open it in Event settings at the top."}{" "}
        Phone numbers and emails are only shown here, to you.
      </p>

      <div className="mb-3 flex flex-wrap gap-2">
        {chips.map((c) => (
          <span
            key={c.label}
            className={`rounded border px-3 py-1 text-xs ${
              c.alert && c.value > 0 ? "border-fofRed text-fofRed" : "border-fofCharcoal text-fofGunmetal"
            }`}
          >
            <span className="font-display text-sm text-fofPaper">{c.value}</span> {c.label}
          </span>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Team ID, team or athlete"
          className="tap-target w-full min-w-0 rounded border border-fofGunmetal bg-transparent px-3 sm:w-auto sm:max-w-sm sm:flex-1"
        />
        <button
          onClick={() => setUnpaidOnly((v) => !v)}
          aria-pressed={unpaidOnly}
          className={`${BTN_SMALL} ${unpaidOnly ? "border-fofRed text-fofRed" : ""}`}
        >
          {unpaidOnly ? "Showing: not paid" : "Show only not paid"}
        </button>
        <button onClick={load} disabled={loading} className={BTN_SMALL}>
          {loading ? "Loading..." : "Refresh"}
        </button>
        <a href="/admin/medic-sheet" target="_blank" rel="noopener noreferrer" className={BTN_SMALL}>
          Medic sheet
        </a>
      </div>

      <RegistrationAlertsBox readOnly={readOnly} />

      <ResultsEmailsBox
        event={event}
        readOnly={readOnly}
        teams={live}
        status={emailStatus}
        onChanged={loadEmailStatus}
      />

      {loadError && <p className="mb-2 text-sm text-fofRed">{loadError}</p>}
      {rowError && <p className="mb-2 text-sm text-fofRed">{rowError}</p>}
      {emailRowError && <p className="mb-2 text-sm text-fofRed">{emailRowError}</p>}
      {linkInfo && (
        <div role="status" className="mb-2 rounded border border-fofRule p-3 text-sm">
          <p>
            <span className="font-mono">{linkInfo.teamId}</span>: {linkInfo.text}
          </p>
          {linkInfo.link && <p className="mt-1 break-all font-mono text-xs text-fofGunmetal">{linkInfo.link}</p>}
          <button onClick={() => setLinkInfo(null)} className="mt-1 text-xs underline">
            Close
          </button>
        </div>
      )}

      {list === null && !loadError && <p className="text-sm text-fofGunmetal">Loading...</p>}
      {list !== null && teams.length === 0 && <p className="text-sm text-fofGunmetal">No teams have signed up yet.</p>}

      {/* Phones: one card per team (the wide table needs a laptop). */}
      {teams.length > 0 && (
        <ul className="space-y-3 md:hidden">
          {shown.map((t) => {
            const withdrawn = t.status === "withdrawn";
            const busy = busyId === t.id;
            const med = countOf(t.medicalFlags);
            const signed = countOf(t.signed);
            const members = [...t.members].sort((a, b) => a.position - b.position);
            return (
              <li
                key={t.id}
                className={`rounded-lg border border-fofCharcoal bg-fofPanel p-3 ${withdrawn ? "opacity-60" : ""}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display text-lg leading-tight">{t.team_name}</p>
                    <p className="text-xs text-fofGunmetal">
                      <span className="font-mono">{t.id}</span> · {t.division ?? "—"} ·{" "}
                      <span className={waitingToSign(t) ? "text-fofRed" : "capitalize"}>{statusLabel(t)}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                    {med > 0 && (
                      <span className="rounded border border-fofRed px-2 py-0.5 text-fofRed">
                        {med} medical note{med === 1 ? "" : "s"}
                      </span>
                    )}
                    <span className="text-fofGunmetal">
                      Signed {signed}/{members.length || 2}
                    </span>
                  </div>
                </div>

                <div className="mt-2 space-y-1 text-sm">
                  {members.map((m) => (
                    <div key={m.position}>
                      <span>
                        {m.first_name} {m.surname}
                      </span>
                      <span className="block text-xs text-fofGunmetal">
                        <a href={`tel:${m.phone}`} className="underline">
                          {m.phone}
                        </a>{" "}
                        ·{" "}
                        <a href={`mailto:${m.email}`} className="break-all underline">
                          {m.email}
                        </a>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-fofGunmetal">Paid</p>
                    <PaymentControls t={t} busy={busy} />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] uppercase tracking-wide text-fofGunmetal">Heat</p>
                    <select
                      value={t.wave ?? ""}
                      disabled={readOnly || withdrawn || busy}
                      onChange={(e) => patch(t, { wave: e.target.value === "" ? null : Number(e.target.value) })}
                      aria-label={`Assign heat for ${t.id}`}
                      className="tap-target w-full rounded border border-fofGunmetal bg-transparent px-2 disabled:opacity-50"
                    >
                      <option value="" className="bg-fofBlack">
                        {t.wave == null ? "Assign heat" : "No heat"}
                      </option>
                      {sortedWaves.map((w) => (
                        <option key={w.wave_number} value={w.wave_number} className="bg-fofBlack">
                          Heat {w.wave_number} · {wallClock(w.scheduled_start)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {!readOnly && waitingToSign(t) && (
                    <button
                      onClick={() => resendLink(t)}
                      disabled={busy} aria-busy={busy}
                      className="tap-target rounded border border-fofRed px-3 text-fofRed disabled:opacity-50"
                    >
                      Resend link to {members.find((m) => m.position === 2)?.first_name ?? "partner"}
                    </button>
                  )}
                  {!readOnly && t.status === "registered" && !waitingToSign(t) && (
                    <button
                      onClick={() => patch(t, { status: "confirmed" })}
                      disabled={busy} aria-busy={busy}
                      className="tap-target rounded border border-fofRed px-3 text-fofRed disabled:opacity-50"
                    >
                      Confirm
                    </button>
                  )}
                  {!readOnly && !withdrawn && (
                    <button
                      onClick={() => withdraw(t)}
                      disabled={busy} aria-busy={busy}
                      className="tap-target rounded border border-fofGunmetal px-3 text-fofGunmetal disabled:opacity-50"
                    >
                      Withdraw
                    </button>
                  )}
                  {!readOnly && withdrawn && (
                    <button
                      onClick={() => reinstate(t)}
                      disabled={busy} aria-busy={busy}
                      className="tap-target rounded border border-fofGunmetal px-3 disabled:opacity-50"
                    >
                      Reinstate
                    </button>
                  )}
                  <a
                    href={`/admin/registrations/${encodeURIComponent(t.id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto underline"
                  >
                    Signed form
                  </a>
                </div>
                <div className="mt-2 text-xs">
                  <ResultsEmailCell team={t} status={emailStatus} busyKey={resendingKey} onResend={resend} />
                </div>
              </li>
            );
          })}
          {shown.length === 0 && (
            <li className="text-sm text-fofGunmetal">{unpaidOnly ? "Everyone has paid." : `Nothing matches "${search}".`}</li>
          )}
        </ul>
      )}

      {teams.length > 0 && (
        <div className="hidden overflow-x-auto rounded border border-fofCharcoal md:block">
          <table className="w-full min-w-[1240px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-fofGunmetal text-left text-fofGunmetal">
                <th className="p-2">Team ID</th>
                <th className="p-2">Team</th>
                <th className="p-2">Type</th>
                <th className="p-2">Athletes</th>
                <th className="p-2">Heat</th>
                <th className="p-2">Medical</th>
                <th className="p-2">Signed</th>
                <th className="p-2">Paid</th>
                <th className="p-2">Status</th>
                <th className="p-2">Results email</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => {
                const withdrawn = t.status === "withdrawn";
                const busy = busyId === t.id;
                const med = countOf(t.medicalFlags);
                const signed = countOf(t.signed);
                const members = [...t.members].sort((a, b) => a.position - b.position);
                return (
                  <tr key={t.id} className={`border-b border-fofCharcoal align-top ${withdrawn ? "opacity-60" : ""}`}>
                    <td className="p-2 font-mono text-xs">{t.id}</td>
                    <td className="p-2">
                      <span className="font-display">{t.team_name}</span>
                      {t.registered_at && (
                        <span className="block text-[10px] text-fofGunmetal">signed up {sast(t.registered_at, SAST_DATE_TIME)}</span>
                      )}
                    </td>
                    <td className="p-2">{t.division ?? "—"}</td>
                    <td className="p-2">
                      {members.map((m) => (
                        <div key={m.position} className="mb-1">
                          <span>
                            {m.first_name} {m.surname}
                          </span>
                          <span className="block text-xs text-fofGunmetal">
                            <a href={`tel:${m.phone}`} className="underline">
                              {m.phone}
                            </a>{" "}
                            ·{" "}
                            <a href={`mailto:${m.email}`} className="break-all underline">
                              {m.email}
                            </a>
                          </span>
                        </div>
                      ))}
                      {members.length > 0 && (
                        <details className="text-xs text-fofGunmetal">
                          <summary className="cursor-pointer select-none">Emergency contacts</summary>
                          {members.map((m) => (
                            <p key={m.position} className="mt-1">
                              {m.first_name}: {m.emergency_name}
                              {m.emergency_relationship ? ` (${m.emergency_relationship})` : ""} ·{" "}
                              <a href={`tel:${m.emergency_phone}`} className="underline">
                                {m.emergency_phone}
                              </a>
                            </p>
                          ))}
                        </details>
                      )}
                    </td>
                    <td className="p-2">
                      <select
                        value={t.wave ?? ""}
                        disabled={readOnly || withdrawn || busy}
                        onChange={(e) => patch(t, { wave: e.target.value === "" ? null : Number(e.target.value) })}
                        aria-label={`Assign heat for ${t.id}`}
                        className="rounded border border-fofGunmetal bg-transparent px-2 py-1 disabled:opacity-50"
                      >
                        <option value="" className="bg-fofBlack">
                          {t.wave == null ? "Assign heat" : "No heat"}
                        </option>
                        {sortedWaves.map((w) => (
                          <option key={w.wave_number} value={w.wave_number} className="bg-fofBlack">
                            Heat {w.wave_number} · {wallClock(w.scheduled_start)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2">
                      {med > 0 ? (
                        <span className="rounded border border-fofRed px-2 py-0.5 text-xs text-fofRed">
                          {med} note{med === 1 ? "" : "s"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-2">
                      {signed > 0 ? `✓ ${signed}${members.length ? `/${members.length}` : ""}` : "—"}
                    </td>
                    <td className="p-2 min-w-[150px]">
                      <PaymentControls t={t} busy={busy} />
                    </td>
                    <td className="p-2">
                      <span className={`block text-xs ${waitingToSign(t) ? "text-fofRed" : "text-fofGunmetal"}`}>{statusLabel(t)}</span>
                      {!readOnly && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {waitingToSign(t) && (
                            <button
                              onClick={() => resendLink(t)}
                              disabled={busy} aria-busy={busy}
                              className="rounded border border-fofRed px-2 py-1 text-xs text-fofRed disabled:opacity-50"
                            >
                              Resend link
                            </button>
                          )}
                          {t.status === "registered" && !waitingToSign(t) && (
                            <button
                              onClick={() => patch(t, { status: "confirmed" })}
                              disabled={busy} aria-busy={busy}
                              className="rounded border border-fofRed px-2 py-1 text-xs text-fofRed disabled:opacity-50"
                            >
                              Confirm
                            </button>
                          )}
                          {!withdrawn && (
                            <button
                              onClick={() => withdraw(t)}
                              disabled={busy} aria-busy={busy}
                              className="rounded border border-fofGunmetal px-2 py-1 text-xs text-fofGunmetal disabled:opacity-50"
                            >
                              Withdraw
                            </button>
                          )}
                          {withdrawn && (
                            <button
                              onClick={() => reinstate(t)}
                              disabled={busy} aria-busy={busy}
                              className="rounded border border-fofGunmetal px-2 py-1 text-xs disabled:opacity-50"
                            >
                              Reinstate
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-xs">
                      <ResultsEmailCell
                        team={t}
                        status={emailStatus}
                        busyKey={resendingKey}
                        onResend={resend}
                      />
                    </td>
                    <td className="p-2">
                      <a
                        href={`/admin/registrations/${encodeURIComponent(t.id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="whitespace-nowrap text-xs underline"
                      >
                        Signed form
                      </a>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={11} className="p-3 text-sm text-fofGunmetal">
                    Nothing matches &quot;{search}&quot;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// =====================================================================
// Results emails (inside Registrations)
// =====================================================================

type EmailRecord = {
  status: "sent" | "failed" | "skipped";
  recipients: number;
  error: string | null;
  sent_at: string;
};

type EmailStatus = {
  configured: boolean;
  migrated: boolean;
  settings: { email_results_auto: boolean; email_final_auto: boolean } | null;
  locked?: boolean;
  teams: Record<string, { heat?: EmailRecord; final?: EmailRecord }>;
  waves: { wave_number: number; started: boolean; ended: boolean }[];
};

function EmailRecordLine({
  label,
  rec,
  busy,
  onResend,
}: {
  label: string;
  rec: EmailRecord;
  busy: boolean;
  onResend: () => void;
}) {
  if (rec.status === "sent") {
    return (
      <span className="block">
        {label}Sent {sast(rec.sent_at, SAST_HM)} · {rec.recipients} athlete{rec.recipients === 1 ? "" : "s"}
      </span>
    );
  }
  if (rec.status === "skipped") {
    return <span className="block text-fofGunmetal">{label}Skipped (no email)</span>;
  }
  if (rec.error === "sending") {
    return <span className="block text-fofGunmetal">{label}Sending...</span>;
  }
  return (
    <span className="block text-fofRed">
      {label}Failed{" "}
      <button onClick={onResend} disabled={busy} aria-busy={busy} className="ml-1 rounded border border-fofRed px-2 py-0.5 disabled:opacity-50">
        {busy ? "Sending..." : "Send again"}
      </button>
    </span>
  );
}

function ResultsEmailCell({
  team,
  status,
  busyKey,
  onResend,
}: {
  team: RegTeam;
  status: EmailStatus | null;
  busyKey: string | null;
  onResend: (teamId: string, kind: "heat" | "final") => void;
}) {
  if (!status || !status.migrated) return <span className="text-fofGunmetal">—</span>;
  if (team.status === "withdrawn") return <span className="text-fofGunmetal">Not sent (withdrawn)</span>;
  const rec = status.teams[team.id] ?? {};
  const wave = team.wave != null ? status.waves.find((w) => w.wave_number === team.wave) : undefined;

  let heatLine: React.ReactNode;
  if (rec.heat) {
    heatLine = (
      <EmailRecordLine
        label=""
        rec={rec.heat}
        busy={busyKey === `${team.id}:heat`}
        onResend={() => onResend(team.id, "heat")}
      />
    );
  } else if (team.wave == null) {
    heatLine = <span className="block text-fofGunmetal">No heat yet</span>;
  } else if (!wave?.ended) {
    heatLine = <span className="block text-fofGunmetal">Waiting for heat {team.wave}</span>;
  } else if (!status.configured) {
    heatLine = <span className="block text-fofGunmetal">Not sent (email not connected)</span>;
  } else if (status.locked) {
    heatLine = <span className="block text-fofGunmetal">Covered by the final email</span>;
  } else if (status.settings && !status.settings.email_results_auto) {
    heatLine = <span className="block text-fofGunmetal">Not sent (automatic emails off)</span>;
  } else {
    heatLine = <span className="block text-fofGunmetal">Sending within a minute</span>;
  }

  return (
    <div className="min-w-[150px]">
      {heatLine}
      {rec.final && (
        <EmailRecordLine
          label="Final: "
          rec={rec.final}
          busy={busyKey === `${team.id}:final`}
          onResend={() => onResend(team.id, "final")}
        />
      )}
    </div>
  );
}

type AlertSettings = { emails: string[]; on_booked: boolean; on_confirmed: boolean; on_withdrawn: boolean };

/** Admin addresses that get an email when teams book, confirm or withdraw. */
function RegistrationAlertsBox({ readOnly }: { readOnly: boolean }) {
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    callApi("/api/admin/registrations/alerts", "GET").then((r) => {
      if (r.ok && r.data?.settings) setSettings(r.data.settings as AlertSettings);
      else setError(errorOf(r, "Couldn't load the alert settings."));
    });
  }, []);

  // Shows the change at once; goes back if the save fails.
  async function save(next: AlertSettings, done?: string) {
    const before = settings;
    setSettings(next);
    setBusy(true);
    setError(null);
    setMessage(null);
    const r = await callApi("/api/admin/registrations/alerts", "PUT", next);
    setBusy(false);
    if (!r.ok) {
      setSettings(before);
      setError(errorOf(r, "Couldn't save - nothing was changed."));
      return false;
    }
    setSettings(r.data?.settings as AlertSettings);
    if (done) setMessage(done);
    return true;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    const email = draft.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      setError("That doesn't look like an email address.");
      return;
    }
    if (settings.emails.includes(email)) {
      setError("That address is already on the list.");
      return;
    }
    if (await save({ ...settings, emails: [...settings.emails, email] }, `Added ${email}.`)) setDraft("");
  }

  async function sendTest() {
    setBusy(true);
    setError(null);
    setMessage(null);
    const r = await callApi("/api/admin/registrations/alerts", "POST", {});
    setBusy(false);
    if (!r.ok) {
      setError(errorOf(r, "The test email couldn't be sent."));
      return;
    }
    setMessage(`Test email sent to ${settings?.emails.length === 1 ? "1 address" : `${settings?.emails.length} addresses`}.`);
  }

  const toggles: { key: "on_booked" | "on_confirmed" | "on_withdrawn"; label: string }[] = [
    { key: "on_booked", label: "A spot is booked (athlete 1 signed)" },
    { key: "on_confirmed", label: "A team is confirmed (both signed)" },
    { key: "on_withdrawn", label: "A team is withdrawn" },
  ];

  return (
    <div className="mb-4 rounded border border-fofCharcoal bg-fofPanel p-4">
      <h3 className="mb-1 font-display text-base tracking-wide">Registration alerts</h3>
      <p className="mb-3 text-xs text-fofGunmetal">
        These addresses get an email when a team signs up, with the athletes&apos; names, phone numbers and emails. ID numbers,
        addresses and medical answers are never emailed.
      </p>

      {settings === null && !error && <p className="text-sm text-fofGunmetal">Loading...</p>}

      {settings && (
        <>
          <ul className="mb-2 flex flex-wrap gap-2" aria-label="Alert email addresses">
            {settings.emails.length === 0 && <li className="text-sm text-fofRed">No addresses yet - nobody gets these emails.</li>}
            {settings.emails.map((em) => (
              <li key={em} className="flex min-h-[40px] items-center gap-2 rounded border border-fofGunmetal px-3 text-sm">
                <span className="break-all">{em}</span>
                {!readOnly && (
                  <button
                    type="button"
                    disabled={busy} aria-busy={busy}
                    onClick={() => save({ ...settings, emails: settings.emails.filter((x) => x !== em) }, `Removed ${em}.`)}
                    aria-label={`Remove ${em}`}
                    className="grid h-8 w-8 place-items-center text-fofGunmetal hover:text-fofRed disabled:opacity-50"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>

          {!readOnly && (
            <form onSubmit={add} className="mb-3 flex flex-wrap gap-2">
              <input
                type="email"
                inputMode="email"
                autoCapitalize="none"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setError(null);
                }}
                placeholder="name@example.com"
                aria-label="Add an email address"
                className={`${INPUT} w-full min-w-0 sm:w-auto sm:flex-1`}
              />
              <button type="submit" disabled={busy || !draft.trim()} className={BTN_SMALL}>
                Add
              </button>
            </form>
          )}

          <p className="mb-1 text-xs text-fofGunmetal">Send an email when</p>
          <div className="mb-3 space-y-1">
            {toggles.map((tg) => (
              <label key={tg.key} className="flex min-h-[40px] cursor-pointer items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={settings[tg.key]}
                  disabled={readOnly}
                  onChange={(e) => save({ ...settings, [tg.key]: e.target.checked })}
                  className="h-5 w-5"
                  style={{ accentColor: "var(--fof-red)" }}
                />
                {tg.label}
              </label>
            ))}
          </div>

          {!readOnly && (
            <button type="button" onClick={sendTest} disabled={busy || settings.emails.length === 0} className={BTN_SMALL}>
              {busy ? "Working..." : "Send a test email"}
            </button>
          )}
        </>
      )}

      {message && <p className="mt-2 text-sm text-fofPaper">{message}</p>}
      {error && <p className="mt-2 text-sm text-fofRed">{error}</p>}
    </div>
  );
}

function ResultsEmailsBox({
  event,
  readOnly,
  teams,
  status,
  onChanged,
}: {
  event: EventRow;
  readOnly: boolean;
  teams: RegTeam[];
  status: EmailStatus | null;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teamId, setTeamId] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);

  const chosen = teamId || teams[0]?.id || "";

  // The switch flips at once; it flips back if the save fails.
  const [shown, setShown] = useState<Partial<Record<"email_results_auto" | "email_final_auto", boolean>>>({});
  async function toggle(key: "email_results_auto" | "email_final_auto", value: boolean) {
    setShown((s) => ({ ...s, [key]: value }));
    setSaving(key);
    setError(null);
    setMessage(null);
    const r = await callApi(`/api/admin/events/${encodeURIComponent(event.id)}`, "PATCH", { [key]: value });
    setSaving(null);
    if (!r.ok) {
      setShown((s) => ({ ...s, [key]: !value }));
      setError(errorOf(r, "Couldn't save - nothing was changed."));
      return;
    }
    onChanged();
  }

  async function sendTest(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) return;
    setSendingTest(true);
    setError(null);
    setMessage(null);
    const r = await callApi("/api/admin/results-emails/test", "POST", { teamId: chosen, email: testEmail });
    setSendingTest(false);
    if (!r.ok) {
      setError(errorOf(r, "The test email couldn't be sent."));
      return;
    }
    setMessage(`Test email for ${chosen} sent to ${testEmail.trim()}.`);
  }

  const loaded = status?.settings ?? null;
  const settings = loaded ? { ...loaded, ...shown } : null;
  const switches: { key: "email_results_auto" | "email_final_auto"; label: string; hint: string }[] = [
    {
      key: "email_results_auto",
      label: "Email results when a heat ends",
      hint: "Each team's time, place so far and splits, as soon as their heat has ended.",
    },
    {
      key: "email_final_auto",
      label: "Email final places when the event is locked",
      hint: "Sent to every team that raced, right after Finish & lock.",
    },
  ];

  return (
    <div className="mb-4 rounded border border-fofCharcoal bg-fofPanel p-4">
      <h3 className="mb-1 font-display text-base tracking-wide">Results emails</h3>
      <p className="mb-3 text-xs text-fofGunmetal">
        Both athletes of a team get one email each time. Withdrawn teams and teams without an email address are left out.
      </p>

      {status && !status.configured && (
        <p role="status" className="mb-3 rounded border border-fofRed px-3 py-2 text-sm text-fofRed">
          Email sending isn&apos;t connected yet. Nothing will be sent until the email key is set up.
        </p>
      )}
      {status && !status.migrated && (
        <p role="status" className="mb-3 rounded border border-fofRed px-3 py-2 text-sm text-fofRed">
          Results emails aren&apos;t set up in the database yet (sql/020_results_emails.sql).
        </p>
      )}

      {settings && (
        <div className="mb-3 space-y-2">
          {switches.map((s) => (
            <div key={s.key} className="flex flex-wrap items-center gap-3">
              <button
                role="switch"
                aria-checked={settings[s.key]}
                aria-label={s.label}
                disabled={readOnly || saving !== null}
                onClick={() => toggle(s.key, !settings[s.key])}
                className={`rounded border px-3 py-1 text-xs disabled:opacity-50 ${
                  settings[s.key] ? "border-fofRed text-fofRed" : "border-fofGunmetal text-fofGunmetal"
                }`}
              >
                {settings[s.key] ? "✓ On" : "Off"}
              </button>
              <span className="text-sm">
                {s.label}
                <span className="block text-xs text-fofGunmetal">{s.hint}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {teams.length > 0 && (
        <form onSubmit={sendTest} className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-fofGunmetal">
            Team
            <select
              value={chosen}
              onChange={(e) => setTeamId(e.target.value)}
              className="tap-target mt-1 block rounded border border-fofGunmetal bg-transparent px-2"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.id} className="bg-fofBlack">
                  {t.id} · {t.team_name}
                </option>
              ))}
            </select>
          </label>
          <a
            href={`/api/admin/results-emails/preview?teamId=${encodeURIComponent(chosen)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={BTN_SMALL}
          >
            Preview email
          </a>
          <label className="min-w-[220px] flex-1 text-xs text-fofGunmetal sm:max-w-xs">
            Send a test to me
            <input
              type="email"
              required
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="you@example.com"
              className={`${INPUT} mt-1`}
            />
          </label>
          <button type="submit" disabled={sendingTest || !status?.configured} className={BTN_SMALL}>
            {sendingTest ? "Sending..." : "Send test"}
          </button>
        </form>
      )}

      {message && <p className="mt-2 text-sm text-fofPaper">{message}</p>}
      {error && <p className="mt-2 text-sm text-fofRed">{error}</p>}
    </div>
  );
}

// =====================================================================
// Teams & heats
// =====================================================================

function TeamsTab({
  event,
  readOnly,
  rows,
  setRows,
  waveList,
  sortedWaves,
  scansByTeam,
  stations,
  teamsWithViewer,
  setAssignmentList,
  orphanedTeams,
  duplicateTeamNames,
}: {
  event: EventRow;
  readOnly: boolean;
  rows: AdminTeam[];
  setRows: React.Dispatch<React.SetStateAction<AdminTeam[]>>;
  waveList: AdminWave[];
  sortedWaves: AdminWave[];
  scansByTeam: Map<string, AdminScan[]>;
  stations: StationDef[];
  teamsWithViewer: string[];
  setAssignmentList: React.Dispatch<React.SetStateAction<Assignment[]>>;
  orphanedTeams: { id: string; team_name: string }[];
  duplicateTeamNames: { name: string; wave: number; count: number }[];
}) {
  const sequential = event.team_id_scheme === "sequential";
  const [savingId, setSavingId] = useState<string | null>(null);
  // The heat each team had when last saved, to tell when Save moves it.
  const [savedWave, setSavedWave] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(rows.map((t) => [t.id, t.wave]))
  );

  function updateField(id: string, field: keyof AdminTeam, value: string) {
    setRows((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, [field]: field === "wave" ? (value === "" ? null : Number(value)) : value } : t
      )
    );
  }

  async function saveRow(team: AdminTeam) {
    setSavingId(team.id);
    const movingHeat = (team.wave ?? null) !== (savedWave[team.id] ?? null);
    const r = await callApi(`/api/admin/teams/${encodeURIComponent(team.id)}`, "PATCH", {
      team_name: team.team_name,
      athlete_1: team.athlete_1,
      athlete_2: team.athlete_2,
      division: team.division,
      wave: team.wave,
    });
    setSavingId(null);
    if (!r.ok) {
      window.alert(errorOf(r, "Couldn't save this team."));
      return;
    }
    if (movingHeat && !sequential) {
      // Fight-or-Flight-style ids follow the heat - reload to pick them up.
      window.location.reload();
      return;
    }
    setSavedWave((prev) => ({ ...prev, [team.id]: team.wave }));
    if (movingHeat) {
      const heat = waveList.find((w) => w.wave_number === team.wave);
      updateField(team.id, "start_time", heat?.scheduled_start ?? `${event.event_date}T00:00:00`);
    }
  }

  async function setStatus(team: AdminTeam, status: TeamStatus) {
    if (
      status === "withdrawn" &&
      !window.confirm(
        `Withdraw ${team.id} (${team.team_name})?\n\nThey stay on file (with any results) but won't count in the results. You can reinstate them later.`
      )
    )
      return;
    setSavingId(team.id);
    const r = await callApi(`/api/admin/teams/${encodeURIComponent(team.id)}`, "PATCH", { status });
    setSavingId(null);
    if (!r.ok) {
      window.alert(errorOf(r, "Couldn't change this team."));
      return;
    }
    setRows((prev) => prev.map((t) => (t.id === team.id ? { ...t, status } : t)));
  }

  async function deleteTeam(team: AdminTeam) {
    if (
      !window.confirm(
        `Delete ${team.id} (${team.team_name || "unnamed"})?\n\nIts judge assignments and its team login are removed too. This can't be undone.`
      )
    )
      return;
    // Gone from the list at once; back again if the server refuses.
    const rowsBefore = rows;
    const removed: Assignment[] = [];
    setRows((prev) => prev.filter((t) => t.id !== team.id));
    setAssignmentList((prev) => {
      removed.push(...prev.filter((a) => a.team_id === team.id));
      return prev.filter((a) => a.team_id !== team.id);
    });
    const r = await callApi(`/api/admin/teams/${encodeURIComponent(team.id)}`, "DELETE");
    if (r.ok) return;
    setRows(rowsBefore);
    setAssignmentList((prev) => [...prev, ...removed]);
    if (r.data?.canWithdraw) {
      if (window.confirm(`${errorOf(r, "This team has results.")}\n\nWithdraw it now?`)) setStatus(team, "withdrawn");
      return;
    }
    window.alert(errorOf(r, "Couldn't delete this team."));
  }

  // --- Add a team ---
  const emptyNewTeam = { team_name: "", athlete_1: "", athlete_2: "", division: "", wave: "" };
  const [newTeam, setNewTeam] = useState(emptyNewTeam);
  const [addingTeam, setAddingTeam] = useState(false);
  const [addTeamStatus, setAddTeamStatus] = useState<string | null>(null);

  async function addTeam(e: React.FormEvent) {
    e.preventDefault();
    setAddTeamStatus(null);
    if (!newTeam.team_name.trim()) {
      setAddTeamStatus("A team name is required.");
      return;
    }
    if (!sequential && !newTeam.wave) {
      setAddTeamStatus("Choose a heat for this team.");
      return;
    }
    setAddingTeam(true);
    const r = await callApi("/api/admin/teams", "POST", {
      ...newTeam,
      wave: newTeam.wave === "" ? null : Number(newTeam.wave),
    });
    setAddingTeam(false);
    if (!r.ok) {
      setAddTeamStatus(errorOf(r, "Couldn't add the team."));
      return;
    }
    const team = r.data.team as AdminTeam;
    setRows((prev) => [...prev, team].sort((a, b) => a.id.localeCompare(b.id)));
    setSavedWave((prev) => ({ ...prev, [team.id]: team.wave }));
    setAddTeamStatus(`Added ${team.id}.`);
    setNewTeam(emptyNewTeam);
  }

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
    const r = await callApi(`/api/admin/team-viewers?teamId=${encodeURIComponent(teamId)}`, "GET");
    setEditViewerLoading(false);
    if (!r.ok) {
      setEditViewerStatus(errorOf(r, "Couldn't look up this login."));
      return;
    }
    const viewers: { id: string; username: string }[] = r.data.viewers ?? [];
    if (viewers.length > 1) {
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
    if (!window.confirm("Delete this login? Whoever has these details won't be able to sign in with them any more.")) return;
    setEditViewerLoading(true);
    const r = await callApi(`/api/admin/team-viewers?viewerId=${encodeURIComponent(viewerId)}`, "DELETE");
    if (!r.ok) {
      setEditViewerLoading(false);
      setEditViewerStatus(errorOf(r, "Couldn't delete that login."));
      return;
    }
    await loadViewers(teamId);
  }

  async function deleteAllViewers(teamId: string, count: number) {
    if (!window.confirm(`Delete all ${count} logins for this team? None of them will work any more - create one fresh login afterwards.`)) return;
    setEditViewerLoading(true);
    const r = await callApi(`/api/admin/team-viewers?teamId=${encodeURIComponent(teamId)}`, "DELETE");
    setEditViewerLoading(false);
    if (!r.ok) {
      setEditViewerStatus(errorOf(r, "Couldn't delete these logins."));
      return;
    }
    setEditingViewerFor(null);
    window.location.reload();
  }

  async function saveEditViewer(teamId: string) {
    setEditViewerSaving(true);
    setEditViewerStatus(null);
    const r = await callApi("/api/admin/team-viewers", "PATCH", {
      teamId,
      username: editViewerUsername || undefined,
      password: editViewerPassword || undefined,
    });
    setEditViewerSaving(false);
    if (!r.ok) {
      setEditViewerStatus(errorOf(r, "Couldn't save this login."));
      return;
    }
    setEditViewerStatus("Saved.");
    setEditViewerPassword("");
    window.setTimeout(() => setEditingViewerFor(null), 1200);
  }

  // --- Grouping: by heat, then "No heat yet" ---
  const waveNumbers = new Set(waveList.map((w) => w.wave_number));
  const groups: { key: string; label: string; teams: AdminTeam[] }[] = sortedWaves.map((w) => ({
    key: `h${w.wave_number}`,
    label: `Heat ${w.wave_number} · ${wallClock(w.scheduled_start)}${w.actual_start ? (w.actual_end ? " · finished" : " · running") : ""}`,
    teams: rows.filter((t) => savedWave[t.id] === w.wave_number || (savedWave[t.id] === undefined && t.wave === w.wave_number)),
  }));
  const missing = rows.filter((t) => {
    const w = savedWave[t.id] !== undefined ? savedWave[t.id] : t.wave;
    return w != null && !waveNumbers.has(w);
  });
  if (missing.length > 0) groups.push({ key: "missing", label: "Heat that no longer exists", teams: missing });
  const noHeat = rows.filter((t) => (savedWave[t.id] !== undefined ? savedWave[t.id] : t.wave) == null);
  if (noHeat.length > 0 || sequential) groups.push({ key: "none", label: "No heat yet", teams: noHeat });

  const sortInGroup = (a: AdminTeam, b: AdminTeam) =>
    (a.status === "withdrawn" ? 1 : 0) - (b.status === "withdrawn" ? 1 : 0) || a.id.localeCompare(b.id);

  const cellInput = "border-b border-transparent bg-transparent focus:border-fofRed disabled:opacity-70";

  return (
    <section className="mb-10 min-w-0">
      <h2 className={H2}>Teams &amp; heats</h2>

      {orphanedTeams.length > 0 && (
        <p className="mb-4 text-sm text-fofRed">
          {orphanedTeams.length} team(s) point at a heat that no longer exists (
          {orphanedTeams.map((o) => o.id).join(", ")}) - choose a real heat for them below.
        </p>
      )}
      {duplicateTeamNames.length > 0 && (
        <p className="mb-4 text-sm text-fofRed">
          {duplicateTeamNames.length} name(s) are used by more than one team in the SAME heat (
          {duplicateTeamNames.map((d) => `"${d.name}" in heat ${d.wave} (${d.count}x)`).join(", ")}) - give one of
          them a different name below.
        </p>
      )}

      {!readOnly && (
        <form onSubmit={addTeam} className="mb-4 flex flex-wrap items-end gap-2 rounded border border-fofCharcoal p-3 text-sm">
          <div className="min-w-0">
            <label className="mb-1 block text-xs text-fofGunmetal">Team name</label>
            <input
              value={newTeam.team_name}
              onChange={(e) => setNewTeam((p) => ({ ...p, team_name: e.target.value }))}
              maxLength={60}
              className="w-full rounded border border-fofGunmetal bg-transparent px-2 py-1"
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs text-fofGunmetal">Athlete 1</label>
            <input
              value={newTeam.athlete_1}
              onChange={(e) => setNewTeam((p) => ({ ...p, athlete_1: e.target.value }))}
              className="w-full rounded border border-fofGunmetal bg-transparent px-2 py-1"
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-xs text-fofGunmetal">Athlete 2</label>
            <input
              value={newTeam.athlete_2}
              onChange={(e) => setNewTeam((p) => ({ ...p, athlete_2: e.target.value }))}
              className="w-full rounded border border-fofGunmetal bg-transparent px-2 py-1"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-fofGunmetal">Division</label>
            <select
              value={newTeam.division}
              onChange={(e) => setNewTeam((p) => ({ ...p, division: e.target.value }))}
              className="rounded border border-fofGunmetal bg-transparent px-2 py-1"
            >
              <option value="" className="bg-fofBlack">-</option>
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
                {sequential ? "No heat yet" : "Choose..."}
              </option>
              {sortedWaves.map((w) => (
                <option key={w.wave_number} value={w.wave_number} className="bg-fofBlack">
                  Heat {w.wave_number}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={addingTeam} className={BTN_PRIMARY}>
            {addingTeam ? "Adding..." : "Add team"}
          </button>
          <span className="text-xs text-fofGunmetal">
            {sequential
              ? `The Team ID is given automatically (${event.team_id_prefix}001, ${event.team_id_prefix}002 ...) and never changes.`
              : `ID is assigned automatically (${event.team_id_prefix} + heat time + position).`}
          </span>
          {addTeamStatus && <span className="text-xs text-fofRed">{addTeamStatus}</span>}
        </form>
      )}

      {sequential && !readOnly && (
        <p className="mb-3 text-xs text-fofGunmetal">
          Moving a team to another heat never changes its Team ID - its QR code and login keep working.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-fofGunmetal text-left text-fofGunmetal">
              <th className="p-2">ID</th>
              <th className="p-2">Team Name</th>
              <th className="p-2">Athlete 1</th>
              <th className="p-2">Athlete 2</th>
              <th className="p-2">Division</th>
              <th className="p-2">Heat</th>
              <th className="p-2">Race</th>
              <th className="p-2">Viewer Login</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.key}>
              <tr>
                <td colSpan={9} className="bg-fofPanel p-2 font-display text-xs tracking-wide text-fofGunmetal">
                  {g.label} ({g.teams.filter((t) => t.status !== "withdrawn").length})
                </td>
              </tr>
              {g.teams.length === 0 && (
                <tr>
                  <td colSpan={9} className="p-2 text-xs text-fofGunmetal">
                    No teams.
                  </td>
                </tr>
              )}
              {[...g.teams].sort(sortInGroup).map((team) => {
                const teamScans = scansByTeam.get(team.id) ?? [];
                const next = getNextAction(teamScans, stations);
                const teamWave = waveList.find((w) => w.wave_number === team.wave);
                const started = hasWaveStarted(teamWave);
                const hasViewer = teamsWithViewer.includes(team.id);
                const withdrawn = team.status === "withdrawn";
                const busy = savingId === team.id;
                return (
                  <tr key={team.id} className={`border-b border-fofCharcoal ${withdrawn ? "opacity-60" : ""}`}>
                    <td className="p-2 font-mono text-xs">{team.id}</td>
                    <td className="p-2">
                      <input
                        value={team.team_name ?? ""}
                        disabled={readOnly}
                        onChange={(e) => updateField(team.id, "team_name", e.target.value)}
                        className={`w-32 ${cellInput}`}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={team.athlete_1 ?? ""}
                        disabled={readOnly}
                        onChange={(e) => updateField(team.id, "athlete_1", e.target.value)}
                        className={`w-28 ${cellInput}`}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={team.athlete_2 ?? ""}
                        disabled={readOnly}
                        onChange={(e) => updateField(team.id, "athlete_2", e.target.value)}
                        className={`w-28 ${cellInput}`}
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={team.division ?? ""}
                        disabled={readOnly}
                        onChange={(e) => updateField(team.id, "division", e.target.value)}
                        className={cellInput}
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
                        disabled={readOnly || teamScans.length > 0}
                        title={teamScans.length > 0 ? "This team has scans - it can't change heat" : undefined}
                        onChange={(e) => updateField(team.id, "wave", e.target.value)}
                        className={cellInput}
                      >
                        <option value="" className="bg-fofBlack">
                          {sequential ? "No heat yet" : "-"}
                        </option>
                        {sortedWaves.map((w) => (
                          <option key={w.wave_number} value={w.wave_number} className="bg-fofBlack">
                            Heat {w.wave_number}
                          </option>
                        ))}
                        {team.wave != null && !waveNumbers.has(team.wave) && (
                          <option value={team.wave} className="bg-fofBlack">
                            Heat {team.wave} (missing)
                          </option>
                        )}
                      </select>
                    </td>
                    <td className="p-2">
                      {withdrawn ? (
                        <span className="text-fofGunmetal">Withdrawn</span>
                      ) : started ? (
                        <span className="text-fofPaper">{next.isFinished ? "✓ Finished" : "Started"}</span>
                      ) : (
                        <span className="text-fofGunmetal">
                          Not started{team.status === "registered" ? " · registered" : ""}
                        </span>
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
                                <p className="text-fofRed">{editViewerDuplicates.length} logins found for this team.</p>
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
                                    <button onClick={() => deleteDuplicateViewer(team.id, v.id)} className="text-fofRed underline">
                                      Delete
                                    </button>
                                  </div>
                                ))}
                                <button onClick={() => setEditingViewerFor(null)} className="text-xs text-fofGunmetal underline">
                                  Cancel
                                </button>
                                {editViewerStatus && <p className="text-xs text-fofGunmetal">{editViewerStatus}</p>}
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
                                  <button onClick={() => setEditingViewerFor(null)} className="text-xs text-fofGunmetal underline">
                                    Cancel
                                  </button>
                                </div>
                                {editViewerStatus && <p className="text-xs text-fofGunmetal">{editViewerStatus}</p>}
                              </>
                            )}
                          </div>
                        ) : (
                          <span className="flex items-center gap-2">
                            <span className="text-fofGunmetal">✓ set up</span>
                            <button onClick={() => startEditViewer(team.id)} className="text-fofGunmetal underline">
                              Edit
                            </button>
                          </span>
                        )
                      ) : (
                        <span className="text-fofRed">none yet</span>
                      )}
                    </td>
                    <td className="p-2">
                      {!readOnly && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => saveRow(team)}
                            disabled={busy} aria-busy={busy}
                            className="rounded border border-fofRed px-2 py-1 text-fofRed disabled:opacity-50"
                          >
                            {busy ? "Saving..." : "Save"}
                          </button>
                          {withdrawn ? (
                            <button
                              onClick={() => setStatus(team, "registered")}
                              disabled={busy} aria-busy={busy}
                              className="rounded border border-fofGunmetal px-2 py-1 text-fofGunmetal hover:border-fofRed hover:text-fofRed"
                            >
                              Reinstate
                            </button>
                          ) : (
                            <button
                              onClick={() => setStatus(team, "withdrawn")}
                              disabled={busy} aria-busy={busy}
                              className="rounded border border-fofGunmetal px-2 py-1 text-fofGunmetal hover:border-fofRed hover:text-fofRed"
                            >
                              Withdraw
                            </button>
                          )}
                          {teamScans.length === 0 && (
                            <button
                              onClick={() => deleteTeam(team)}
                              className="rounded border border-fofGunmetal px-2 py-1 text-fofGunmetal hover:border-fofRed hover:text-fofRed"
                              aria-label={`Delete ${team.id}`}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}

// =====================================================================
// Judges & logins
// =====================================================================

function PeopleTab({
  readOnly,
  rows,
  judgeList,
  setJudgeList,
  assignmentList,
  setAssignmentList,
  teamsWithViewer,
}: {
  readOnly: boolean;
  rows: AdminTeam[];
  judgeList: Judge[];
  setJudgeList: React.Dispatch<React.SetStateAction<Judge[]>>;
  assignmentList: Assignment[];
  setAssignmentList: React.Dispatch<React.SetStateAction<Assignment[]>>;
  teamsWithViewer: string[];
}) {
  const liveTeams = rows.filter((t) => t.status !== "withdrawn");
  const activeJudges = judgeList.filter((j) => j.active);
  const [showInactive, setShowInactive] = useState(false);
  const [judgeMessage, setJudgeMessage] = useState<string | null>(null);

  // --- Create judge ---
  const [judgeName, setJudgeName] = useState("");
  const [judgeUsername, setJudgeUsername] = useState("");
  const [judgePassword, setJudgePassword] = useState("");
  const [judgeTeamIds, setJudgeTeamIds] = useState<string[]>([]);
  const [creatingJudge, setCreatingJudge] = useState(false);
  const [judgeCreateStatus, setJudgeCreateStatus] = useState<string | null>(null);

  async function createJudge(e: React.FormEvent) {
    e.preventDefault();
    setJudgeCreateStatus(null);
    setCreatingJudge(true);
    const r = await callApi("/api/admin/judges", "POST", {
      name: judgeName,
      username: judgeUsername,
      password: judgePassword,
      teamIds: readOnly ? [] : judgeTeamIds,
    });
    setCreatingJudge(false);
    if (!r.ok) {
      setJudgeCreateStatus(errorOf(r, "Something went wrong."));
      return;
    }
    setJudgeCreateStatus(
      `Created! Give this judge username "${judgeUsername}" and the password you chose.${r.data.warning ? ` ${r.data.warning}` : ""}`
    );
    setJudgeName("");
    setJudgeUsername("");
    setJudgePassword("");
    setJudgeTeamIds([]);
    setTimeout(() => window.location.reload(), 1500);
  }

  // --- Create one team login ---
  const firstWithout = liveTeams.find((t) => !teamsWithViewer.includes(t.id));
  const [viewerTeamId, setViewerTeamId] = useState(firstWithout?.id ?? liveTeams[0]?.id ?? "");
  const [viewerUsername, setViewerUsername] = useState("");
  const [viewerPassword, setViewerPassword] = useState("");
  const [creatingViewer, setCreatingViewer] = useState(false);
  const [viewerCreateStatus, setViewerCreateStatus] = useState<string | null>(null);

  async function createViewer(e: React.FormEvent) {
    e.preventDefault();
    setViewerCreateStatus(null);
    setCreatingViewer(true);
    const r = await callApi("/api/admin/team-viewers", "POST", {
      teamId: viewerTeamId,
      username: viewerUsername,
      password: viewerPassword,
    });
    setCreatingViewer(false);
    if (!r.ok) {
      setViewerCreateStatus(errorOf(r, "Something went wrong."));
      return;
    }
    setViewerCreateStatus(`Created! Give ${viewerTeamId} username "${viewerUsername}" and the password you chose.`);
    setViewerUsername("");
    setViewerPassword("");
    setTimeout(() => window.location.reload(), 1500);
  }

  // --- Bulk team logins ---
  const withoutLogin = liveTeams.filter((t) => !teamsWithViewer.includes(t.id)).length;
  const [bulkPassword, setBulkPassword] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);

  async function createBulk(e: React.FormEvent) {
    e.preventDefault();
    setBulkStatus(null);
    if (bulkPassword.length < 8) {
      setBulkStatus("The shared password must be at least 8 characters.");
      return;
    }
    if (
      !window.confirm(
        `Create a login for every team that doesn't have one yet (${withoutLogin})?\n\nEach username is the Team ID in small letters (e.g. ${(liveTeams[0]?.id ?? "sv001").toLowerCase()}), all with the password you typed.`
      )
    )
      return;
    setBulkBusy(true);
    const r = await callApi("/api/admin/team-viewers", "POST", { mode: "bulk", password: bulkPassword });
    setBulkBusy(false);
    if (!r.ok) {
      setBulkStatus(errorOf(r, "Couldn't create the logins."));
      return;
    }
    const failed: string[] = r.data.failed ?? [];
    setBulkStatus(
      `Created ${r.data.created} login${r.data.created === 1 ? "" : "s"}. Skipped ${r.data.skipped} that already had one.` +
        (failed.length ? ` Couldn't create: ${failed.join(", ")}.` : "") +
        " Reloading..."
    );
    setBulkPassword("");
    setTimeout(() => window.location.reload(), 3500);
  }

  // --- Edit / delete / reactivate judges ---
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
    const r = await callApi(`/api/admin/judges/${judgeId}`, "PATCH", {
      name: editJudgeName,
      username: editJudgeUsername || undefined,
      password: editJudgePassword || undefined,
    });
    setJudgeEditBusy(false);
    if (!r.ok) {
      setJudgeEditStatus(errorOf(r, "Couldn't save changes."));
      return;
    }
    setJudgeList((prev) => prev.map((j) => (j.id === judgeId ? { ...j, name: editJudgeName } : j)));
    setEditingJudgeId(null);
  }

  async function deleteJudge(judge: Judge) {
    if (
      !window.confirm(
        `Remove ${judge.name}?\n\nIf they have recorded results in any event, they're made inactive instead (their name stays on those results) and only their assignments for this event are removed.`
      )
    )
      return;
    setJudgeMessage(null);
    const r = await callApi(`/api/admin/judges/${judge.id}`, "DELETE");
    if (!r.ok) {
      window.alert(errorOf(r, "Couldn't remove this judge."));
      return;
    }
    const thisEventTeams = new Set(rows.map((t) => t.id));
    if (r.data.deactivated) {
      setJudgeList((prev) => prev.map((j) => (j.id === judge.id ? { ...j, active: false } : j)));
      if (!readOnly) {
        setAssignmentList((prev) => prev.filter((a) => !(a.judge_id === judge.id && thisEventTeams.has(a.team_id))));
      }
      setJudgeMessage(`${judge.name} has recorded results, so they've been made inactive instead of deleted.`);
    } else {
      setJudgeList((prev) => prev.filter((j) => j.id !== judge.id));
      setAssignmentList((prev) => prev.filter((a) => a.judge_id !== judge.id));
      setJudgeMessage(`${judge.name} has been removed.`);
    }
  }

  async function reactivateJudge(judge: Judge) {
    setJudgeList((prev) => prev.map((j) => (j.id === judge.id ? { ...j, active: true } : j)));
    const r = await callApi(`/api/admin/judges/${judge.id}`, "PATCH", { active: true });
    if (!r.ok) {
      setJudgeList((prev) => prev.map((j) => (j.id === judge.id ? { ...j, active: judge.active } : j)));
      window.alert(errorOf(r, "Couldn't reactivate this judge."));
      return;
    }
    setJudgeMessage(`${judge.name} is active again.`);
  }

  // --- Assignments ---
  const [newJudgeId, setNewJudgeId] = useState(activeJudges[0]?.id ?? "");
  const [newTeamIds, setNewTeamIds] = useState<string[]>([]);
  const [assignStatus, setAssignStatus] = useState<string | null>(null);

  async function addAssignment() {
    if (!newJudgeId || newTeamIds.length === 0) return;
    setAssignStatus(null);
    const r = await callApi("/api/admin/assignments", "POST", { judge_id: newJudgeId, team_ids: newTeamIds });
    if (!r.ok) {
      setAssignStatus(errorOf(r, "Couldn't save the assignment."));
      return;
    }
    const assigned: string[] = r.data.assigned ?? [];
    setAssignmentList((prev) => {
      const have = new Set(prev.map((a) => `${a.judge_id}|${a.team_id}`));
      return [
        ...prev,
        ...assigned.filter((t) => !have.has(`${newJudgeId}|${t}`)).map((team_id) => ({ judge_id: newJudgeId, team_id })),
      ];
    });
    setNewTeamIds([]);
  }

  async function removeAssignment(judge_id: string, team_id: string) {
    const before = assignmentList;
    setAssignmentList((prev) => prev.filter((a) => !(a.judge_id === judge_id && a.team_id === team_id)));
    const r = await callApi("/api/admin/assignments", "DELETE", { judge_id, team_id });
    if (!r.ok) {
      setAssignmentList(before);
      window.alert(errorOf(r, "Couldn't remove the assignment."));
    }
  }

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((t) => t !== id) : [...list, id]);
  const eventTeamIds = new Set(rows.map((t) => t.id));
  const shownJudges = judgeList.filter((j) => j.active || showInactive);

  return (
    <>
      <section className="mb-10 grid gap-8 md:grid-cols-2">
        <div className="min-w-0">
          <h2 className={H2}>Create a judge login</h2>
          <form onSubmit={createJudge} className="space-y-2 rounded border border-fofCharcoal p-4">
            <input
              placeholder="Judge's name (e.g. Nicolene)"
              value={judgeName}
              onChange={(e) => setJudgeName(e.target.value)}
              required
              className={INPUT}
            />
            <input
              placeholder="Username (e.g. nicolene)"
              value={judgeUsername}
              onChange={(e) => setJudgeUsername(e.target.value)}
              required
              autoCapitalize="none"
              className={INPUT}
            />
            <PasswordInput
              placeholder="Password (min 6 characters)"
              value={judgePassword}
              onChange={setJudgePassword}
              required
              minLength={6}
              className={`${INPUT} pr-12`}
            />
            {!readOnly && (
              <div className="max-h-36 overflow-y-auto rounded border border-fofCharcoal p-2 text-sm">
                <p className="mb-1 text-fofGunmetal">Assign teams (optional, can add later):</p>
                {liveTeams.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 py-0.5">
                    <input type="checkbox" checked={judgeTeamIds.includes(t.id)} onChange={() => setJudgeTeamIds((p) => toggle(p, t.id))} />
                    {t.id} - {t.team_name}
                  </label>
                ))}
                {liveTeams.length === 0 && <p className="text-xs text-fofGunmetal">No teams yet.</p>}
              </div>
            )}
            <button type="submit" disabled={creatingJudge} className="tap-target w-full rounded btn-stamped font-display disabled:opacity-50">
              {creatingJudge ? "Creating..." : "Create judge login"}
            </button>
            {judgeCreateStatus && <p className="text-sm text-fofGunmetal">{judgeCreateStatus}</p>}
          </form>
        </div>

        <div className="min-w-0">
          <h2 className={H2}>Create a team login</h2>
          <form onSubmit={createViewer} className="space-y-2 rounded border border-fofCharcoal p-4">
            <select value={viewerTeamId} onChange={(e) => setViewerTeamId(e.target.value)} className={INPUT}>
              {liveTeams.map((t) => (
                <option key={t.id} value={t.id} className="bg-fofBlack">
                  {t.id} - {t.team_name} {teamsWithViewer.includes(t.id) ? "(already has one)" : ""}
                </option>
              ))}
            </select>
            <input
              placeholder={`Username (e.g. ${(viewerTeamId || "sv001").toLowerCase()})`}
              value={viewerUsername}
              onChange={(e) => setViewerUsername(e.target.value)}
              required
              autoCapitalize="none"
              className={INPUT}
            />
            <PasswordInput
              placeholder="Password (min 6 characters)"
              value={viewerPassword}
              onChange={setViewerPassword}
              required
              minLength={6}
              className={`${INPUT} pr-12`}
            />
            <button
              type="submit"
              disabled={creatingViewer || !viewerTeamId}
              className="tap-target w-full rounded btn-stamped font-display disabled:opacity-50"
            >
              {creatingViewer ? "Creating..." : "Create team login"}
            </button>
            {viewerCreateStatus && <p className="text-sm text-fofGunmetal">{viewerCreateStatus}</p>}
          </form>

          <form onSubmit={createBulk} className="mt-4 space-y-2 rounded border border-fofCharcoal p-4">
            <p className="font-display text-sm">Create logins for every team without one</p>
            <p className="text-xs text-fofGunmetal">
              {withoutLogin === 0
                ? "Every team already has a login."
                : `${withoutLogin} team${withoutLogin === 1 ? "" : "s"} without a login. Each gets the username of its Team ID in small letters, and all share the one password you type here. Teams that already have a login are left as they are.`}
            </p>
            <PasswordInput
              placeholder="Shared password (min 8 characters)"
              value={bulkPassword}
              onChange={setBulkPassword}
              minLength={8}
              className={`${INPUT} pr-12`}
            />
            <button
              type="submit"
              disabled={bulkBusy || withoutLogin === 0}
              className="tap-target w-full rounded btn-stamped font-display disabled:opacity-50"
            >
              {bulkBusy ? "Creating..." : "Create the logins"}
            </button>
            {bulkStatus && <p className="text-sm text-fofGunmetal">{bulkStatus}</p>}
          </form>
        </div>
      </section>

      <section className="mb-10 min-w-0">
        <h2 className={H2}>Judges &amp; assignments</h2>
        <p className="mb-3 text-sm text-fofGunmetal">
          Judges are shared by every event. Assignments here are for this event&apos;s teams only.
        </p>

        {!readOnly && (
          <div className="mb-4 flex flex-wrap items-start gap-2">
            <select
              value={newJudgeId}
              onChange={(e) => setNewJudgeId(e.target.value)}
              className="rounded border border-fofGunmetal bg-transparent px-2 py-1"
            >
              {activeJudges.map((j) => (
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
              <div className="mt-2 max-h-48 w-56 max-w-full overflow-y-auto border-t border-fofCharcoal pt-2 text-sm">
                {liveTeams.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 py-0.5">
                    <input type="checkbox" checked={newTeamIds.includes(t.id)} onChange={() => setNewTeamIds((p) => toggle(p, t.id))} />
                    {t.id} - {t.team_name}
                  </label>
                ))}
              </div>
            </details>

            <button
              onClick={addAssignment}
              disabled={newTeamIds.length === 0 || !newJudgeId}
              className="rounded border border-fofRed px-3 py-1 text-fofRed disabled:opacity-50"
            >
              Assign
            </button>
            {assignStatus && <span className="text-xs text-fofRed">{assignStatus}</span>}
          </div>
        )}

        <label className="mb-3 flex items-center gap-2 text-sm text-fofGunmetal">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive judges ({judgeList.length - activeJudges.length})
        </label>
        {judgeMessage && <p className="mb-3 text-sm text-fofPaper">{judgeMessage}</p>}

        <ul className="space-y-2">
          {shownJudges.map((judge) => {
            const teamIds = assignmentList
              .filter((a) => a.judge_id === judge.id && eventTeamIds.has(a.team_id))
              .map((a) => a.team_id);
            const isEditing = editingJudgeId === judge.id;
            return (
              <li key={judge.id} className={`rounded border border-fofCharcoal p-2 text-sm ${judge.active ? "" : "opacity-70"}`}>
                {!isEditing ? (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="font-display">{judge.name}</span>{" "}
                      {!judge.active && <span className={`${PILL} border-fofGunmetal text-fofGunmetal`}>Inactive</span>}
                      {judge.active && teamIds.length === 0 && <span className="text-fofGunmetal"> - no teams assigned</span>}
                      {teamIds.map((tid) => (
                        <span key={tid} className="ml-2 inline-flex items-center gap-1 rounded bg-fofCharcoal px-2 py-0.5 font-mono text-xs">
                          {tid}
                          {!readOnly && (
                            <button
                              onClick={() => removeAssignment(judge.id, tid)}
                              className="text-fofRed"
                              aria-label={`Remove ${tid} from ${judge.name}`}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-3 text-xs">
                      <button onClick={() => startEditJudge(judge)} className="text-fofGunmetal underline">
                        Edit
                      </button>
                      {judge.active ? (
                        <button onClick={() => deleteJudge(judge)} className="text-fofRed underline">
                          Delete
                        </button>
                      ) : (
                        <button onClick={() => reactivateJudge(judge)} className="text-fofRed underline">
                          Reactivate
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input value={editJudgeName} onChange={(e) => setEditJudgeName(e.target.value)} placeholder="Name" className={INPUT} />
                    <input
                      value={editJudgeUsername}
                      onChange={(e) => setEditJudgeUsername(e.target.value)}
                      placeholder="New username (leave blank to keep current)"
                      autoCapitalize="none"
                      className={INPUT}
                    />
                    <PasswordInput
                      value={editJudgePassword}
                      onChange={setEditJudgePassword}
                      placeholder="New password (leave blank to keep current)"
                      className={`${INPUT} pr-12`}
                    />
                    <div className="flex gap-2">
                      <button onClick={() => saveJudgeEdit(judge.id)} disabled={judgeEditBusy} className={BTN_PRIMARY}>
                        {judgeEditBusy ? "Saving..." : "Save"}
                      </button>
                      <button onClick={() => setEditingJudgeId(null)} className="tap-target rounded border border-fofGunmetal px-4 text-fofGunmetal">
                        Cancel
                      </button>
                    </div>
                    {judgeEditStatus && <p className="text-xs text-fofGunmetal">{judgeEditStatus}</p>}
                  </div>
                )}
              </li>
            );
          })}
          {shownJudges.length === 0 && <li className="text-sm text-fofGunmetal">No judges yet.</li>}
        </ul>
      </section>
    </>
  );
}

// =====================================================================
// Course (stations)
// =====================================================================

function CourseTab({
  readOnly,
  stations,
  eventHasScans,
}: {
  readOnly: boolean;
  stations: StationDef[];
  eventHasScans: boolean;
}) {
  const [stationRows, setStationRows] = useState<StationDef[]>(stations);
  const [newStationName, setNewStationName] = useState("");
  const [newStationDetail, setNewStationDetail] = useState("");
  const [newStationIsRun, setNewStationIsRun] = useState(false);
  const [addingStation, setAddingStation] = useState(false);
  const [stationError, setStationError] = useState<string | null>(null);

  // Edits are staged: nothing saves until "Save changes".
  const [editingStations, setEditingStations] = useState(false);
  const [draftStations, setDraftStations] = useState<StationDef[]>([]);
  const [savingStations, setSavingStations] = useState(false);

  const courseFixed = eventHasScans || readOnly;

  async function addStation(e: React.FormEvent) {
    e.preventDefault();
    if (!newStationName.trim()) return;
    setAddingStation(true);
    setStationError(null);
    const r = await callApi("/api/admin/stations", "POST", {
      name: newStationName.trim(),
      isRun: newStationIsRun,
      detail: newStationDetail.trim() || null,
    });
    setAddingStation(false);
    if (!r.ok) {
      setStationError(errorOf(r, "Couldn't add that station."));
      return;
    }
    setStationRows((prev) => [...prev, r.data.station as StationDef]);
    setNewStationName("");
    setNewStationDetail("");
    setNewStationIsRun(false);
  }

  function updateDraftStation(number: number, patch: Partial<StationDef>) {
    setDraftStations((prev) => prev.map((s) => (s.number === number ? { ...s, ...patch } : s)));
  }

  async function saveStationEdits() {
    setSavingStations(true);
    setStationError(null);
    const changed = draftStations.filter((d) => {
      const o = stationRows.find((s) => s.number === d.number);
      return o && (o.name !== d.name || o.isRun !== d.isRun || (o.detail ?? "") !== (d.detail ?? ""));
    });
    for (const s of changed) {
      const r = await callApi(`/api/admin/stations/${s.number}`, "PATCH", {
        name: s.name,
        isRun: s.isRun,
        detail: s.detail ?? null,
      });
      if (!r.ok) {
        setStationError(`Station ${s.number}: ${errorOf(r, "couldn't save")}`);
        setSavingStations(false);
        return;
      }
    }
    setStationRows(draftStations.map((s) => ({ ...s, detail: s.detail?.trim() ? s.detail.trim() : null })));
    setSavingStations(false);
    setEditingStations(false);
  }

  async function deleteStation(number: number) {
    if (!window.confirm(`Remove station ${number}?`)) return;
    setStationError(null);
    const before = stationRows;
    setStationRows((prev) => prev.filter((s) => s.number !== number));
    const r = await callApi(`/api/admin/stations/${number}`, "DELETE");
    if (!r.ok) {
      setStationRows(before);
      setStationError(errorOf(r, "Couldn't remove that station."));
    }
  }

  // --- Reorder ---
  const [reorderingStations, setReorderingStations] = useState(false);
  const [draftOrder, setDraftOrder] = useState<StationDef[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

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
    const r = await callApi("/api/admin/stations/reorder", "PUT", { order: draftOrder.map((s) => s.number) });
    setSavingOrder(false);
    if (!r.ok) {
      setStationError(errorOf(r, "Couldn't save the new order."));
      return;
    }
    // Numbers were reassigned on the server (1, 2, 3 ...) to match.
    setStationRows(draftOrder.map((s, i) => ({ ...s, number: i + 1 })));
    setReorderingStations(false);
  }

  const runBadge = (
    <span className="ml-2 rounded border border-fofGunmetal px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fofGunmetal">
      Run
    </span>
  );
  const maxNumber = stationRows.reduce((m, s) => Math.max(m, s.number), 0);

  return (
    <CollapsibleSection title="Stations" defaultOpen={true}>
      <p className="mb-3 text-sm text-fofGunmetal">
        The course for this event, in order. Renaming and changing the detail line are always safe. Reordering,
        adding and removing stations (and switching a station to or from a run) are only possible before this
        event has any scan - once real times exist, changing the course would make a recorded time mean the wrong
        exercise.
      </p>
      {eventHasScans && !readOnly && (
        <p className="mb-3 text-sm text-fofRed">This event already has scans, so the course order is fixed now.</p>
      )}

      {!readOnly && !reorderingStations && !editingStations && (
        <div className="mb-3 flex flex-wrap gap-2">
          {!courseFixed && (
            <button
              onClick={() => {
                setDraftOrder(stationRows);
                setReorderingStations(true);
                setStationError(null);
              }}
              className={BTN}
            >
              Edit order
            </button>
          )}
          <button
            onClick={() => {
              setDraftStations(stationRows);
              setEditingStations(true);
              setStationError(null);
            }}
            className={BTN}
          >
            Edit stations
          </button>
        </div>
      )}

      {reorderingStations && (
        <div className="mb-3 flex gap-2">
          <button onClick={saveStationOrder} disabled={savingOrder} className={BTN_PRIMARY}>
            {savingOrder ? "Saving..." : "Save order"}
          </button>
          <button onClick={() => setReorderingStations(false)} className="tap-target rounded border border-fofGunmetal px-4 py-2 text-sm text-fofGunmetal">
            Cancel
          </button>
        </div>
      )}

      {editingStations && (
        <div className="mb-3 flex gap-2">
          <button onClick={saveStationEdits} disabled={savingStations} className={BTN_PRIMARY}>
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
              <span className="min-w-0 flex-1 text-sm">
                {s.name}
                {s.isRun && runBadge}
                {s.detail && <span className="block text-xs text-fofGunmetal">{s.detail}</span>}
              </span>
              <div className="flex flex-col pr-1">
                <button
                  type="button"
                  aria-label={`Move ${s.name} up`}
                  disabled={i === 0}
                  onClick={() => moveDraftStation(i, i - 1)}
                  className="px-2 text-xs text-fofGunmetal disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  aria-label={`Move ${s.name} down`}
                  disabled={i === draftOrder.length - 1}
                  onClick={() => moveDraftStation(i, i + 1)}
                  className="px-2 text-xs text-fofGunmetal disabled:opacity-30"
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
            <li key={s.number} className="flex flex-wrap items-center gap-2 border-b border-fofCharcoal py-1.5">
              <span className="w-8 shrink-0 text-sm text-fofGunmetal">{s.number}.</span>
              <input
                value={s.name}
                onChange={(e) => updateDraftStation(s.number, { name: e.target.value })}
                maxLength={80}
                aria-label={`Name of station ${s.number}`}
                className="tap-target min-w-0 flex-1 rounded border border-fofGunmetal bg-transparent px-2 py-1 text-sm"
              />
              <input
                value={s.detail ?? ""}
                onChange={(e) => updateDraftStation(s.number, { detail: e.target.value })}
                maxLength={120}
                placeholder="Detail, e.g. 240m · 2x 24kg / 2x 16kg"
                aria-label={`Detail of station ${s.number}`}
                className="tap-target min-w-0 flex-1 rounded border border-fofGunmetal bg-transparent px-2 py-1 text-sm"
              />
              <label
                className={`flex items-center gap-1 text-xs text-fofGunmetal ${eventHasScans ? "opacity-50" : ""}`}
                title={eventHasScans ? "Fixed - this event already has scans" : "This is a run, not an exercise"}
              >
                <input
                  type="checkbox"
                  checked={s.isRun}
                  disabled={eventHasScans}
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
              <span className="min-w-0 flex-1 text-sm">
                {s.name}
                {s.isRun && runBadge}
                {s.detail && <span className="block text-xs text-fofGunmetal">{s.detail}</span>}
              </span>
              {!courseFixed && s.number === maxNumber && (
                <button onClick={() => deleteStation(s.number)} className="text-xs text-fofRed underline">
                  Delete
                </button>
              )}
            </li>
          ))}
          {stationRows.length === 0 && (
            <li className="text-sm text-fofGunmetal">No stations yet{readOnly ? "." : " - add the first one below."}</li>
          )}
        </ul>
      )}

      {!courseFixed && !reorderingStations && !editingStations && (
        <form onSubmit={addStation} className="flex flex-wrap items-end gap-3">
          <input
            value={newStationName}
            onChange={(e) => setNewStationName(e.target.value)}
            placeholder={`Station ${stationRows.length + 1} name`}
            maxLength={80}
            className="tap-target min-w-0 flex-1 rounded border border-fofGunmetal bg-transparent px-3"
          />
          <input
            value={newStationDetail}
            onChange={(e) => setNewStationDetail(e.target.value)}
            placeholder="Detail (optional), e.g. 240m · 2x 24kg"
            maxLength={120}
            className="tap-target min-w-0 flex-1 rounded border border-fofGunmetal bg-transparent px-3"
          />
          <label className="flex items-center gap-1 text-sm text-fofGunmetal">
            <input type="checkbox" checked={newStationIsRun} onChange={(e) => setNewStationIsRun(e.target.checked)} />
            This is a run, not an exercise
          </label>
          <button type="submit" disabled={addingStation} className={BTN_PRIMARY}>
            {addingStation ? "Adding..." : "Add station"}
          </button>
        </form>
      )}
      {stationError && <p className="mt-2 text-sm text-fofRed">{stationError}</p>}

      {!reorderingStations && stationRows.length > 0 && (
        <div className="mt-4 border-t border-fofCharcoal pt-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-fofGunmetal">What every team actually does, in order</p>
          <p className="break-words text-sm text-fofGunmetal">
            {stationRows
              .map((s) => (s.isRun ? `${s.name} (run)` : s.name))
              .concat(["FINISH"])
              .join(" → ")}
          </p>
          <p className="mt-1 text-xs text-fofGunmetal">
            This is exactly what judges will confirm, in exactly this order - if a run happens somewhere, add it as
            its own station wherever it belongs (nothing is added automatically).
          </p>
        </div>
      )}
    </CollapsibleSection>
  );
}

// =====================================================================
// Event tools: event report, duplicates, danger zone
// =====================================================================

function ToolsTab({ event, readOnly }: { event: EventRow; readOnly: boolean }) {
  // --- Import from Excel (kept, but hidden) ---
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
    try {
      const res = await fetch("/api/admin/import", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
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
        msg += ` Couldn't match these judge names to an existing login: ${s.unmatchedJudgeNames.join(", ")}.`;
      }
      setImportStatus(msg);
      setTimeout(() => window.location.reload(), 3000);
    } catch {
      setImporting(false);
      setImportStatus("Couldn't reach the server - check your connection.");
    }
  }

  // --- Event report ---
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
    try {
      const res = await fetch("/api/admin/event-report", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      setReportUploading(false);
      if (!res.ok) {
        setReportStatus(data.error ?? "Upload failed.");
        return;
      }
      const s = data.summary ?? {};
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
      if ((data.errors ?? []).length === 0) setTimeout(() => window.location.reload(), 2500);
    } catch {
      setReportUploading(false);
      setReportStatus("Couldn't reach the server - check your connection.");
    }
  }

  // --- Duplicate team clean-up ---
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
    const r = await callApi("/api/admin/duplicate-teams", "GET");
    setDupLoading(false);
    if (!r.ok) {
      setDupError(errorOf(r, "Couldn't check for duplicates."));
      return;
    }
    setDupGroups(r.data.groups ?? []);
  }

  async function deleteDuplicateTeams() {
    if (!dupGroups) return;
    const ids = dupGroups.filter((g) => !g.hasScans).flatMap((g) => g.remove.map((t) => t.id));
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} duplicate team(s) from ${event.name}? This can't be undone.`)) return;
    setDupDeleting(true);
    setDupError(null);
    const r = await callApi("/api/admin/duplicate-teams", "POST", { ids });
    setDupDeleting(false);
    if (!r.ok) {
      setDupError(errorOf(r, "Couldn't delete duplicates."));
      return;
    }
    setDupResult(`Deleted ${r.data.deleted} duplicate team(s).`);
    setDupGroups(null);
    window.setTimeout(() => window.location.reload(), 2000);
  }

  // --- Danger zone (two steps: choose, then type the event name) ---
  const [resetScope, setResetScope] = useState<"race-data" | "full" | null>(null);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetStatus, setResetStatus] = useState<string | null>(null);
  const nameMatches = resetConfirmText.trim() === event.name.trim();

  async function runReset() {
    if (!nameMatches || !resetScope) return;
    setResetting(true);
    setResetStatus(null);
    const r = await callApi("/api/admin/reset", "POST", { scope: resetScope, confirmName: resetConfirmText.trim() });
    setResetting(false);
    if (!r.ok) {
      setResetStatus(errorOf(r, "Something went wrong."));
      return;
    }
    setResetStatus("Done. Reloading...");
    setTimeout(() => window.location.reload(), 1200);
  }

  return (
    <>
      {/* Hidden for now at Louise's request - not deleted, just not
          rendered. Flip this back to true to bring it back. */}
      {false && (
        <CollapsibleSection title="Import from Excel" defaultOpen={false}>
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
              <input type="file" accept=".xlsx" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} className="text-sm" />
            </div>
            <button type="submit" disabled={importing} className={BTN_PRIMARY}>
              {importing ? "Importing..." : "Import"}
            </button>
          </form>
          {importStatus && <p className="mt-2 text-sm text-fofGunmetal">{importStatus}</p>}
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Event report" defaultOpen={true}>
        <p className="mb-3 text-sm text-fofGunmetal">
          Download {event.name} - stations, heats and teams - as a spreadsheet
          {readOnly
            ? "."
            : ", make corrections in Excel (add a station, move a team to another heat, add or remove a heat), then upload it back here. Team IDs are always worked out by the system, never typed by hand."}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <a href="/api/admin/event-report" className={`${BTN} inline-block`}>
            Download event report
          </a>
          {!readOnly && (
            <a href="/api/admin/event-report?blank=1" className={`${BTN} inline-block`}>
              Download blank template
            </a>
          )}
        </div>
        {!readOnly && (
          <form onSubmit={runEventReportImport} className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-0">
              <label className="mb-1 block text-xs text-fofGunmetal">Corrected workbook (.xlsx)</label>
              <input type="file" accept=".xlsx" onChange={(e) => setReportFile(e.target.files?.[0] ?? null)} className="max-w-full text-sm" />
            </div>
            <button type="submit" disabled={reportUploading} className={BTN_PRIMARY}>
              {reportUploading ? "Applying..." : "Apply corrections"}
            </button>
          </form>
        )}
        {reportStatus && <p className="mt-2 text-sm text-fofGunmetal">{reportStatus}</p>}
        {reportErrors.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-fofRed">
            {reportErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      {readOnly ? (
        <p className="mb-10 rounded border border-fofCharcoal p-4 text-sm text-fofGunmetal">
          Duplicate clean-up and resets aren&apos;t available for a finished, locked event.
        </p>
      ) : (
        <>
          <CollapsibleSection title="Clean up duplicate teams" defaultOpen={true}>
            <p className="mb-3 text-sm text-fofGunmetal">
              Finds teams in {event.name} in the same heat with identical athlete names - almost always leftover
              copies from testing. Nothing is deleted until you review the list and confirm. A team that already
              has a scan recorded is never touched.
            </p>
            <button onClick={findDuplicateTeams} disabled={dupLoading} className={BTN}>
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
                            {g.keep.athlete_1} &amp; {g.keep.athlete_2} - {g.keep.wave == null ? "no heat" : `heat ${g.keep.wave}`}
                            {g.hasScans && (
                              <span className="ml-2 text-fofRed">(has a scan recorded - none of this group will be touched)</span>
                            )}
                          </p>
                          <p>
                            Keeping:{" "}
                            <span className="text-fofPaper">
                              {g.keep.id} ({g.keep.team_name})
                            </span>
                          </p>
                          <p className="text-fofRed">
                            {g.hasScans ? "Would remove" : "Removing"}: {g.remove.map((t) => `${t.id} (${t.team_name})`).join(", ")}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={deleteDuplicateTeams}
                      disabled={dupDeleting || dupGroups.every((g) => g.hasScans)}
                      className={BTN_PRIMARY}
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

          <section className="mt-12 rounded border-2 border-fofRed p-4">
            <h2 className="mb-2 font-display text-lg text-fofRed">Danger zone - {event.name} only</h2>
            <p className="mb-4 text-sm text-fofGunmetal">
              These only ever touch {event.name}. Other events and the judges themselves are never touched. Export
              to Excel first if you want to keep a record - what is deleted can&apos;t be recovered.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded border border-fofCharcoal p-3">
                <p className="font-display text-sm">Reset race data</p>
                <p className="mb-2 text-xs text-fofGunmetal">
                  Clears this event&apos;s scans, penalties and heat start/end times. Teams, judges and assignments
                  stay exactly as they are - use this to re-run the event from zero (e.g. after a test).
                </p>
                <button
                  onClick={() => {
                    setResetScope("race-data");
                    setResetConfirmText("");
                    setResetStatus(null);
                  }}
                  className={BTN_SMALL}
                >
                  Reset race data...
                </button>
              </div>

              <div className="rounded border border-fofCharcoal p-3">
                <p className="font-display text-sm">Full reset of this event</p>
                <p className="mb-2 text-xs text-fofGunmetal">
                  Everything above, plus deletes every team of this event with their team logins and judge
                  assignments. Heats, stations and judges are kept. Team numbering starts at{" "}
                  {event.team_id_prefix}001 again.
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
                    ? `This deletes ALL teams of ${event.name}, their logins and assignments, and all race data. This can't be undone.`
                    : `This deletes all scans, penalties and heat times of ${event.name}. Teams and judges stay. This can't be undone.`}
                </p>
                <p className="mb-2 text-sm text-fofGunmetal">
                  Type the event name <span className="font-mono text-fofRed">{event.name}</span> to confirm:
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    value={resetConfirmText}
                    onChange={(e) => setResetConfirmText(e.target.value)}
                    className="tap-target min-w-0 flex-1 rounded border border-fofGunmetal bg-transparent px-3"
                  />
                  <button onClick={runReset} disabled={!nameMatches || resetting} className={BTN_PRIMARY}>
                    {resetting ? "Resetting..." : "Confirm"}
                  </button>
                  <button onClick={() => setResetScope(null)} className="tap-target rounded border border-fofGunmetal px-4 text-fofGunmetal">
                    Cancel
                  </button>
                </div>
                {resetStatus && <p className="mt-2 text-sm text-fofGunmetal">{resetStatus}</p>}
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
