import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { readFile } from "fs/promises";
import path from "path";
import { brandFor, formatEventDate } from "@/lib/events";
import { formatDuration } from "@/lib/timing";
import { loadTeamResult, ordinal, teamForToken } from "@/lib/teamResult";

// The share picture for the passwordless results link: 1080 x 1350 PNG
// (Instagram portrait), Survivor dark style.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function logoDataUrl(logoPath: string, req: NextRequest): Promise<string | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), "public", logoPath.replace(/^\/+/, "")));
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    /* public/ isn't always bundled with the function - fetch it instead */
  }
  try {
    const res = await fetch(new URL(logoPath, req.nextUrl.origin), { cache: "no-store" });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  let teamId: string | null = null;
  try {
    teamId = await teamForToken(params.token);
  } catch {
    teamId = null;
  }
  if (!teamId) return NextResponse.json({ error: "This link has expired." }, { status: 404 });

  const result = await loadTeamResult(teamId).catch(() => null);
  if (!result || result.team.status === "withdrawn") {
    return NextResponse.json({ error: "This link has expired." }, { status: 404 });
  }

  const { event, team } = result;
  const brand = brandFor(event);
  const survivor = event.theme === "survivor";
  const dark = survivor ? "#050B18" : "#0E0D0C";
  const accent = survivor ? "#2E9BFF" : "#E8262D";
  const muted = survivor ? "#8A9BBC" : "#7A756C";
  const paper = survivor ? "#EEF4FF" : "#F4F1EA";
  const logo = await logoDataUrl(brand.logo, req);

  const finished = result.status === "finished" && result.timeMs != null;
  const big = finished ? formatDuration(result.timeMs ?? 0) : `${result.stationsDone}/${result.stationsTotal} stations`;
  const sub = finished
    ? result.divisionRank != null
      ? `${ordinal(result.divisionRank)} in ${team.division?.trim() || "division"}${result.heatsToGo > 0 ? " so far" : ""}`
      : "Finished"
    : `in ${formatDuration(result.timeMs ?? 0)}`;
  const athletes = [team.athlete_1, team.athlete_2].map((n) => (n ?? "").trim()).filter(Boolean).join(" & ");
  const fileName = `${event.name}-${team.id}`.replace(/[^A-Za-z0-9-]+/g, "-") + ".png";

  const image = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          background: `radial-gradient(120% 80% at 50% 0%, ${survivor ? "#0F2A55" : "#3A1214"} 0%, ${dark} 65%)`,
          color: paper,
          padding: "80px 70px 60px 70px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} width={300} height={300} style={{ borderRadius: brand.logoRound ? 150 : 0 }} alt="" />
          ) : null}
          <div style={{ display: "flex", fontSize: 56, fontWeight: 700, color: accent, marginTop: 30, letterSpacing: 4 }}>
            {event.name.toUpperCase()}
          </div>
          <div style={{ display: "flex", fontSize: 30, color: muted, marginTop: 8 }}>
            {`${formatEventDate(event.event_date)}${event.venue ? ` · ${event.venue}` : ""}`}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 40, color: paper, letterSpacing: 3 }}>
            {finished ? "CONGRATULATIONS!" : "WHAT A FIGHT!"}
          </div>
          <div style={{ display: "flex", fontSize: 64, fontWeight: 700, marginTop: 16, textAlign: "center" }}>{team.team_name}</div>
          {athletes ? <div style={{ display: "flex", fontSize: 32, color: muted, marginTop: 8 }}>{athletes}</div> : null}
          <div style={{ display: "flex", fontSize: finished ? 170 : 120, fontWeight: 700, color: accent, marginTop: 30 }}>{big}</div>
          <div style={{ display: "flex", fontSize: 44, color: paper, marginTop: 6 }}>{sub}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "flex", fontSize: 26, color: muted }}>The Box · Mission To Move</div>
          <div style={{ display: "flex", fontSize: 22, color: muted, marginTop: 8 }}>by Datavera Analytics</div>
        </div>
      </div>
    ),
    { width: 1080, height: 1350 }
  );

  const headers = new Headers(image.headers);
  headers.set("Content-Disposition", `inline; filename="${fileName}"`);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex");
  return new Response(image.body, { status: 200, headers });
}
