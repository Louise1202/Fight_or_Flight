// SERVER-ONLY. The "Island Pass": the picture a team gets when it signs
// up (on the final screen and attached to the "You're registered" email).
// It shows only what is public anyway - Team ID, team name, athletes'
// names, division, date and check-in - plus a QR code holding the Team ID.
//
// Pass links are signed (HMAC) so nobody can fetch passes by guessing
// Team IDs: /api/register/pass?t=<teamId>.<signature>
import { createHmac, timingSafeEqual } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { brandFor, formatEventDate, EventRow, TEAM_TYPES } from "@/lib/events";

function secret(): string {
  return `island-pass:${process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "dev"}`;
}

export function passToken(teamId: string): string {
  const sig = createHmac("sha256", secret()).update(teamId).digest("base64url").slice(0, 32);
  return `${teamId}.${sig}`;
}

/** The Team ID if the token is genuine, otherwise null. */
export function teamIdFromPassToken(token: string | null): string | null {
  if (!token || !/^[A-Z]{2,4}\d{3,}\.[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const [teamId] = token.split(".");
  const expected = passToken(teamId);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? teamId : null;
}

export type PassData = {
  event: Pick<EventRow, "name" | "theme" | "event_date" | "venue" | "registration_time">;
  teamId: string;
  teamName: string;
  athletes: string[];
  division: string | null;
};

async function publicDataUrl(rel: string): Promise<string | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), "public", rel.replace(/^\/+/, "")));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    const base = process.env.PUBLIC_BASE_URL || "https://race.betterdesk.app";
    try {
      const res = await fetch(new URL(rel, base), { cache: "no-store" });
      if (!res.ok) return null;
      return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
    } catch {
      return null;
    }
  }
}

/** 1080 x 1350 PNG (fits a phone screen and Instagram portrait). */
export async function renderIslandPass(d: PassData): Promise<ImageResponse> {
  const brand = brandFor(d.event);
  const survivor = d.event.theme === "survivor";
  const accent = survivor ? "#2E9BFF" : "#E8262D";
  const dark = survivor ? "#050B18" : "#0E0D0C";
  const panel = survivor ? "#0F2550" : "#2A1414";
  const muted = survivor ? "#8A9BBC" : "#7A756C";
  const paper = survivor ? "#EEF4FF" : "#F4F1EA";
  const [logo, qr] = await Promise.all([
    publicDataUrl(brand.logo),
    QRCode.toDataURL(`${d.event.name.toUpperCase()}:${d.teamId}`, { margin: 1, width: 360 }),
  ]);
  const type = TEAM_TYPES.find((t) => t.division === d.division);
  const year = d.event.event_date.slice(0, 4);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          background: `linear-gradient(180deg, ${survivor ? "#071433" : "#1A0C0C"} 0%, ${dark} 60%)`,
          color: paper,
          padding: "70px 70px 50px 70px",
          fontFamily: "sans-serif",
        }}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} width={260} height={260} style={{ borderRadius: brand.logoRound ? 130 : 0 }} alt="" />
        ) : null}
        <div style={{ display: "flex", fontSize: 44, color: accent, marginTop: 24, letterSpacing: 6, fontWeight: 700 }}>
          {`ISLAND PASS · ${d.event.name.toUpperCase()} ${year}`}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            marginTop: 40,
            background: panel,
            border: `3px solid ${accent}`,
            borderRadius: 36,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", padding: "44px 48px", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", maxWidth: 560 }}>
              <div style={{ display: "flex", fontSize: 26, color: muted, letterSpacing: 4 }}>TEAM ID</div>
              <div style={{ display: "flex", fontSize: 130, fontWeight: 700, letterSpacing: 4, lineHeight: 1 }}>{d.teamId}</div>
              <div style={{ display: "flex", fontSize: 46, fontWeight: 700, marginTop: 18 }}>{d.teamName}</div>
              <div style={{ display: "flex", fontSize: 30, color: muted, marginTop: 8 }}>{d.athletes.join(" & ")}</div>
              {type ? (
                <div style={{ display: "flex", fontSize: 28, color: accent, marginTop: 10 }}>{`${type.label} · ${type.division}`}</div>
              ) : null}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} width={250} height={250} style={{ borderRadius: 16, background: "#fff", padding: 10 }} alt="" />
          </div>
          <div style={{ display: "flex", borderTop: `3px dashed ${accent}` }}>
            {[
              ["DATE", formatEventDate(d.event.event_date)],
              ["CHECK-IN", d.event.registration_time ?? "-"],
              ["VENUE", d.event.venue ?? "-"],
            ].map(([k, v], i) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                  padding: "26px 30px",
                  borderLeft: i === 0 ? "none" : `3px dashed ${accent}`,
                }}
              >
                <div style={{ display: "flex", fontSize: 22, color: muted, letterSpacing: 3 }}>{k}</div>
                <div style={{ display: "flex", fontSize: 38, fontWeight: 700, marginTop: 6 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 30, color: paper, marginTop: 44, textAlign: "center" }}>
          Show this pass at check-in. Your heat follows by email.
        </div>
        <div style={{ display: "flex", flexGrow: 1 }} />
        <div style={{ display: "flex", fontSize: 24, color: muted }}>The Box · Mission To Move</div>
        <div style={{ display: "flex", fontSize: 20, color: muted, marginTop: 6 }}>by Datavera Analytics</div>
      </div>
    ),
    { width: 1080, height: 1350 }
  );
}
