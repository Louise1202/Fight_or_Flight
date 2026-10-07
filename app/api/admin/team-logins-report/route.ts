import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { readFileSync } from "fs";
import path from "path";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent } from "@/lib/activeEvent";
import { brandFor } from "@/lib/events";
import { chunk, fetchAll } from "@/lib/fetchAll";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function emailToUsername(email: string): string {
  return email.split("@")[0];
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "event";
}

const ROW_WHITE = "FFFFFFFF";

type TeamLite = { id: string; team_name: string; athlete_1: string | null; athlete_2: string | null; wave: number | null };

/** Every auth user's email by id, read in pages of 1000 (one call per page, not per team). */
async function emailsById(admin: ReturnType<typeof createAdminClient>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let page = 1; page < 1000; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("auth listUsers failed");
    const users = data?.users ?? [];
    for (const u of users) if (u.email) out.set(u.id, u.email);
    if (users.length < 1000) break;
  }
  return out;
}

export async function GET() {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  let event;
  let teams: TeamLite[];
  const usernameByTeamId = new Map<string, string>();
  try {
    event = await getActiveEvent(admin);
    teams = await fetchAll<TeamLite>((from, to) =>
      admin
        .from("teams")
        .select("id, team_name, athlete_1, athlete_2, wave")
        .eq("event_id", event!.id)
        .neq("status", "withdrawn")
        .order("id", { ascending: true })
        .range(from, to)
    );
    const viewers: { id: string; team_id: string }[] = [];
    for (const ids of chunk(teams.map((t) => t.id))) {
      const { data, error } = await admin.from("team_viewers").select("id, team_id").in("team_id", ids);
      if (error) throw new Error("team_viewers query failed");
      viewers.push(...(data ?? []));
    }
    const emails = viewers.length > 0 ? await emailsById(admin) : new Map<string, string>();
    for (const v of viewers) {
      const email = emails.get(v.id);
      if (email) usernameByTeamId.set(v.team_id, emailToUsername(email));
    }
  } catch {
    return NextResponse.json({ error: "The report couldn't be built right now - please try again." }, { status: 500 });
  }

  const brand = brandFor(event);
  const { dark, accent, light, band } = brand.excel;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = `${event.name} Race Timing`;
  const sheet = workbook.addWorksheet("Team Logins");

  const colWidths = [14, 22, 18, 18, 8, 20, 46];
  sheet.columns = colWidths.map((width) => ({ width }));

  // --- Branded header: logo + title ---
  const headerRow = sheet.getRow(1);
  headerRow.height = 60;
  for (let c = 1; c <= colWidths.length; c++) {
    sheet.getCell(1, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: dark } };
  }
  sheet.mergeCells(1, 2, 1, colWidths.length);
  const titleCell = sheet.getCell(1, 2);
  titleCell.value = `${brand.title.toUpperCase()}  —  Team Logins`;
  titleCell.font = { name: "Arial", bold: true, size: 16, color: { argb: accent } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };

  try {
    const logoPath = path.join(process.cwd(), "public", ...brand.reportLogo.split("/"));
    const logoBuffer = readFileSync(logoPath);
    const imageId = workbook.addImage({ buffer: logoBuffer as any, extension: "png" });
    sheet.addImage(imageId, { tl: { col: 0.05, row: 0.05 }, ext: { width: 76, height: 76 } });
  } catch {
    // Logo not found at runtime - the report still generates fine without it.
  }

  // --- Column headers ---
  const headers = ["Team ID", "Team Name", "Athlete 1", "Athlete 2", "Heat", "Username", "Password"];
  const headerLabelRow = sheet.getRow(2);
  headers.forEach((h, i) => {
    const cell = headerLabelRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: "Arial", bold: true, size: 11, color: { argb: light } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: dark } };
    cell.border = { bottom: { style: "medium", color: { argb: accent } } };
  });
  headerLabelRow.height = 20;

  // --- Data rows, alternating banding ---
  teams.forEach((t, i) => {
    const username = usernameByTeamId.get(t.id);
    const row = sheet.getRow(i + 3);
    const values = [
      t.id,
      t.team_name,
      t.athlete_1,
      t.athlete_2,
      t.wave ?? "",
      username ?? "(none yet)",
      username
        ? "(already set - can't be retrieved; use Edit on /admin to set a new one)"
        : "(no login yet - use the create form on /admin)",
    ];
    values.forEach((v, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = v as ExcelJS.CellValue;
      cell.font = {
        name: "Arial",
        size: 10.5,
        color: { argb: username ? dark : accent },
        italic: colIdx === 6,
        bold: colIdx === 5,
      };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 === 0 ? band : ROW_WHITE } };
    });
  });

  sheet.views = [{ state: "frozen", ySplit: 2 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${slug(event.name)}-${event.event_date}-team-logins.xlsx`;

  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
