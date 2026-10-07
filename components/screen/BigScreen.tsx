"use client";

// The venue's big screen (option B): Men, Women and Mixed side by side.
// Nobody touches it during the race - it refreshes itself every 4 seconds,
// heat clocks tick by the server's time, and it never shows contact or
// medical details. Press F (or the button) for full screen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { formatDuration } from "@/lib/timing";
import { groupByDivision, RankedStanding } from "@/lib/leaderboard";
import type { PublicEvent, PublicStanding, PublicWave, StationRecord } from "@/components/results/data";
import { serverNow, syncClock } from "@/lib/clock";

type Data = {
  event: PublicEvent;
  standings: PublicStanding[];
  waves: PublicWave[];
  records: StationRecord[];
};

type Brand = { logo: string; logoRound: boolean; partners: { src: string; alt: string }[] };

const DIVISION_COLOURS: Record<string, string> = {
  Men: "#2E9BFF",
  Women: "#c46cf0",
  Mixed: "#2fbf8f",
  Kids: "#F4C430",
};

// Planned heat times are wall-clock values stored in the UTC fields
// (see lib/teamId.ts): 07:00 means 07:00 at the venue.
function plannedLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
// ...and as a real moment, the venue being in South Africa (UTC+2, no DST).
function plannedMoment(iso: string): number {
  const d = new Date(iso);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()) - 2 * 3600 * 1000;
}

function whereShort(s: PublicStanding): string {
  if (s.status === "stopped") return "Stopped";
  if (s.status === "not_started") return s.team.wave != null ? `Heat ${s.team.wave}` : "";
  if (s.currentEventType === "leave") return `Stn ${s.currentStationIndex}`;
  return s.currentStationLabel === "FINISH" ? "Run → finish" : `Run → ${s.currentStationIndex}`;
}

export default function BigScreen({ initial, brand, followUrl }: { initial: Data; brand: Brand; followUrl: string }) {
  const [data, setData] = useState<Data>(initial);
  const [now, setNow] = useState(() => serverNow());
  const [offline, setOffline] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [isFull, setIsFull] = useState(false);
  const [tick, setTick] = useState(0);
  const seenFinish = useRef<Map<string, number>>(new Map());

  // Data every 4 s; the clock every second.
  useEffect(() => {
    syncClock();
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/leaderboard?eventId=${encodeURIComponent(initial.event.id)}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        const json = (await res.json()) as Data;
        if (!stop) {
          setData(json);
          setOffline(false);
        }
      } catch {
        if (!stop) setOffline(true);
      }
    };
    const poll = setInterval(load, 4000);
    const clock = setInterval(() => setNow(serverNow()), 1000);
    const ticker = setInterval(() => setTick((t) => t + 1), 7000);
    return () => {
      stop = true;
      clearInterval(poll);
      clearInterval(clock);
      clearInterval(ticker);
    };
  }, [initial.event.id]);

  useEffect(() => {
    QRCode.toDataURL(followUrl, { margin: 1, width: 240 }).then(setQr).catch(() => setQr(null));
  }, [followUrl]);

  // Keep the screen awake and the mouse pointer out of the way.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        lock = await (navigator as any).wakeLock?.request("screen");
      } catch {}
    };
    request();
    const onVis = () => document.visibilityState === "visible" && request();
    document.addEventListener("visibilitychange", onVis);
    const onFull = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFull);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("fullscreenchange", onFull);
      lock?.release().catch(() => {});
    };
  }, []);

  const goFull = useCallback(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") goFull();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goFull]);

  // Already in Men, Women, Mixed, Kids order.
  const groups = useMemo(() => groupByDivision(data.standings), [data.standings]);

  // A team that finished in the last 60 seconds glows green.
  const recentFinish = (s: PublicStanding): boolean => {
    if (s.status !== "finished" || s.startTime == null || s.rawMs == null) return false;
    const finishedAt = new Date(s.startTime).getTime() + s.rawMs;
    return now - finishedAt < 60_000;
  };

  const running = data.waves.filter((w) => w.actual_start && !w.actual_end);
  const nextHeat = data.waves
    .filter((w) => !w.actual_start)
    .sort((a, b) => a.wave_number - b.wave_number)[0];
  const heatMinutes = data.event.heat_minutes ?? 60;

  const finishedCount = data.standings.filter((s) => s.status === "finished").length;
  const total = data.standings.length;

  // Bottom line: newest finishes and station records, taking turns.
  const tickerItems = useMemo(() => {
    const items: string[] = [];
    const finishers = data.standings
      .filter((s) => s.status === "finished" && s.startTime && s.rawMs != null)
      .sort((a, b) => new Date(b.startTime!).getTime() + b.rawMs! - (new Date(a.startTime!).getTime() + a.rawMs!))
      .slice(0, 3);
    const ranked = groupByDivision(data.standings).flatMap((g) => g.standings);
    for (const f of finishers) {
      const r = ranked.find((x) => x.team.id === f.team.id);
      items.push(
        `Just finished: ${f.team.team_name} · ${formatDuration(f.finalMs ?? 0)}${
          r?.divisionRank ? ` · ${ordinal(r.divisionRank)} ${f.team.division ?? ""}` : ""
        }`
      );
    }
    for (const rec of data.records.slice(0, 12)) {
      items.push(`Fastest ${rec.name} today: ${rec.teamName} · ${formatDuration(rec.ms)}`);
    }
    if (items.length === 0) items.push("Scan the code to follow the race live on your phone");
    return items;
  }, [data]);
  const tickerText = tickerItems[tick % tickerItems.length];

  const cols = Math.max(1, groups.length);

  return (
    <main
      data-brand={data.event.theme}
      className="ground fixed inset-0 flex select-none flex-col overflow-hidden bg-fofBlack text-fofPaper"
      style={{ padding: "1.6vw 2vw", gap: "1.2vw", cursor: isFull ? "none" : "auto" }}
    >
      {/* Header */}
      <header className="flex items-center" style={{ gap: "1.4vw" }}>
        <img
          src={brand.logo}
          alt=""
          className={brand.logoRound ? "logo-round" : "rounded-full"}
          style={{ width: "5.6vw", height: "5.6vw" }}
        />
        <div>
          <div className="font-marker leading-none text-fofRed" style={{ fontSize: "3.2vw" }}>
            {data.event.name.toUpperCase()}
          </div>
          <div className="text-fofGunmetal" style={{ fontSize: "1.15vw" }}>
            {fmtDate(data.event.event_date)}
            {data.event.venue ? ` · ${data.event.venue}` : ""}
          </div>
        </div>
        <span
          className="nums rounded-full border"
          style={{
            fontSize: "1vw",
            padding: "0.15vw 0.8vw",
            color: offline ? "#F4C430" : "#ff6b6b",
            borderColor: offline ? "#F4C430" : "#ff6b6b",
          }}
        >
          {offline ? "RECONNECTING" : "● LIVE"}
        </span>

        <div className="ml-auto flex items-stretch" style={{ gap: "0.9vw" }}>
          {running.map((w) => {
            const elapsed = now - new Date(w.actual_start!).getTime();
            const late = elapsed > (heatMinutes - 2) * 60_000;
            return (
              <Clock
                key={w.wave_number}
                label={`HEAT ${w.wave_number}`}
                value={formatDuration(Math.max(0, elapsed))}
                tone={late ? "warn" : "live"}
              />
            );
          })}
          {nextHeat && (
            <Clock
              label={`HEAT ${nextHeat.wave_number} STARTS`}
              value={
                running.length === 0 && plannedMoment(nextHeat.scheduled_start) - now > 0 &&
                plannedMoment(nextHeat.scheduled_start) - now < 3 * 3600 * 1000
                  ? formatDuration(plannedMoment(nextHeat.scheduled_start) - now)
                  : plannedLabel(nextHeat.scheduled_start)
              }
              tone="calm"
            />
          )}
          <Clock label="FINISHED" value={`${finishedCount} / ${total}`} tone="calm" />
        </div>
      </header>

      {/* Division columns */}
      <section className="grid min-h-0 flex-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: "1.4vw" }}>
        {groups.length === 0 && (
          <div className="col-span-full grid place-items-center text-fofGunmetal" style={{ fontSize: "2vw" }}>
            Teams appear here once heats are set.
          </div>
        )}
        {groups.map((g) => (
          <DivisionColumn
            key={g.division}
            title={g.division}
            colour={DIVISION_COLOURS[g.division] ?? "#7CC4FF"}
            standings={g.standings}
            now={now}
            recentFinish={recentFinish}
          />
        ))}
      </section>

      {/* Footer */}
      <footer className="flex items-center" style={{ gap: "1.4vw" }}>
        <div
          className="min-w-0 flex-1 truncate rounded-lg border border-fofRule bg-fofPanel"
          style={{ padding: "0.7vw 1.2vw", fontSize: "1.35vw" }}
          aria-live="polite"
        >
          {tickerText}
        </div>
        {qr && (
          <div className="flex items-center" style={{ gap: "0.8vw" }}>
            <img src={qr} alt="" className="rounded bg-white" style={{ width: "5vw", height: "5vw", padding: "0.2vw" }} />
            <span className="leading-tight text-fofGunmetal" style={{ fontSize: "1vw" }}>
              Follow live
              <br />
              on your phone
            </span>
          </div>
        )}
        {brand.partners.map((p) => (
          <img key={p.src} src={p.src} alt={p.alt} style={{ height: "3vw" }} className="w-auto opacity-90" />
        ))}
        <img src="/brand/datavera-on-dark.png" alt="by Datavera Analytics" style={{ height: "2.6vw" }} className="w-auto" />
      </footer>

      {!isFull && (
        <button
          onClick={goFull}
          className="absolute rounded-md border border-fofGunmetal bg-fofPanel text-fofGunmetal hover:text-fofPaper"
          style={{ right: "1vw", bottom: "6.5vw", padding: "0.4vw 0.9vw", fontSize: "0.9vw" }}
        >
          Full screen (F)
        </button>
      )}
    </main>
  );
}

function Clock({ label, value, tone }: { label: string; value: string; tone: "live" | "warn" | "calm" }) {
  return (
    <div className="rounded-lg border border-fofRule bg-fofPanel text-right" style={{ padding: "0.5vw 1.1vw" }}>
      <div className="font-display tracking-wide text-fofGunmetal" style={{ fontSize: "1vw" }}>
        {label}
      </div>
      <div
        className="nums leading-none"
        suppressHydrationWarning
        style={{ fontSize: "2.4vw", color: tone === "warn" ? "#F4C430" : tone === "live" ? "#7CC4FF" : "var(--fof-paper)" }}
      >
        {value}
      </div>
    </div>
  );
}

function DivisionColumn({
  title,
  colour,
  standings,
  now,
  recentFinish,
}: {
  title: string;
  colour: string;
  standings: RankedStanding<PublicStanding>[];
  now: number;
  recentFinish: (s: PublicStanding) => boolean;
}) {
  // Finishers first (fastest first), then teams on the course (furthest
  // first), then stopped; teams that haven't started aren't listed here.
  const shown = standings.filter((s) => s.status !== "not_started");
  const waiting = standings.length - shown.length;
  const MAX = 11;
  const rows = shown.slice(0, MAX);
  const more = shown.length - rows.length;

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-fofRule bg-fofPanel" style={{ padding: "1vw 1.2vw" }}>
      <h2 className="flex items-baseline justify-between font-display tracking-wide" style={{ fontSize: "2.3vw", color: colour }}>
        {title.toUpperCase()}
        <small className="font-body tracking-normal text-fofGunmetal" style={{ fontSize: "1vw" }}>
          {standings.length} team{standings.length === 1 ? "" : "s"}
        </small>
      </h2>
      <ol className="mt-[0.4vw] flex min-h-0 flex-col">
        {rows.map((s) => {
          const first = s.divisionRank === 1;
          const glow = recentFinish(s);
          const elapsed = s.startTime ? now - new Date(s.startTime).getTime() : 0;
          return (
            <li
              key={s.team.id}
              className="grid items-center border-b border-fofRule transition-colors"
              style={{
                gridTemplateColumns: "2.4vw minmax(0,1fr) auto",
                gap: "0.6vw",
                padding: "0.38vw 0",
                background: glow ? "linear-gradient(90deg, rgba(63,208,138,.28), transparent)" : undefined,
              }}
            >
              <span className="nums text-right" style={{ fontSize: "1.3vw", color: first ? "#F4C430" : "var(--fof-gunmetal)" }}>
                {s.divisionRank ?? ""}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold" style={{ fontSize: "1.35vw" }}>
                  {s.team.team_name}
                </span>
                {s.team.athletes && (
                  <span className="block truncate text-fofGunmetal" style={{ fontSize: "0.95vw" }}>
                    {s.team.athletes}
                  </span>
                )}
              </span>
              <span className="text-right">
                {s.status === "finished" ? (
                  <span className="nums block" style={{ fontSize: first ? "1.7vw" : "1.4vw", color: glow ? "#3FD08A" : "var(--fof-paper)" }}>
                    {formatDuration(s.finalMs ?? 0)}
                  </span>
                ) : (
                  <>
                    <span className="nums block" style={{ fontSize: "1.15vw", color: s.status === "stopped" ? "var(--fof-gunmetal)" : "#F4C430" }}>
                      {whereShort(s)}
                    </span>
                    {s.status === "in_progress" && (
                      <span className="nums block text-fofGunmetal" style={{ fontSize: "0.9vw" }} suppressHydrationWarning>
                        {formatDuration(Math.max(0, elapsed))}
                      </span>
                    )}
                  </>
                )}
              </span>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="text-fofGunmetal" style={{ fontSize: "1.2vw", padding: "0.6vw 0" }}>
            {waiting > 0 ? `${waiting} team${waiting === 1 ? "" : "s"} waiting for their heat` : "No teams yet"}
          </li>
        )}
      </ol>
      {(more > 0 || (rows.length > 0 && waiting > 0)) && (
        <p className="mt-auto text-fofGunmetal" style={{ fontSize: "1vw", paddingTop: "0.5vw" }}>
          {more > 0 ? `+ ${more} more on the leaderboard` : ""}
          {more > 0 && waiting > 0 ? " · " : ""}
          {waiting > 0 ? `${waiting} still to start` : ""}
        </p>
      )}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}
