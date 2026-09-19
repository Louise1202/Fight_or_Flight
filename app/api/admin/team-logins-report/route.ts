import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { readFileSync } from "fs";
import path from "path";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function emailToUsername(email: string): string {
  return email.split("@")[0];
}

const FOF_BLACK = "FF0E0D0C";
const FOF_RED = "FFE8262D";
const FOF_PAPER = "FFF4F1EA";
const FOF_CHARCOAL = "FF2A2724";
const ROW_CREAM = "FFF4F1EA";
const ROW_WHITE = "FFFFFFFF";

export async function GET() {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const admin = createAdminClient();

  const [{ data: teams }, { data: viewerRows }] = await Promise.all([
    admin.from("teams").select("id, team_name, athlete_1, athlete_2, wave").order("id"),
    admin.from("team_viewers").select("id, team_id"),
  ]);

  // One auth lookup per viewer to get its actual username - there's no
  // bulk "get many users" call, so this is done individually.
  const usernameByTeamId = new Map<string, string>();
  for (const v of viewerRows ?? []) {
    const { data: authUser } = await admin.auth.admin.getUserById(v.id);
    if (authUser?.user?.email) {
      usernameByTeamId.set(v.team_id, emailToUsername(authUser.user.email));
    }
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Team Logins");

  const colWidths = [14, 16, 18, 18, 8, 20, 46];
  sheet.columns = colWidths.map((width) => ({ width }));

  // --- Branded header: logo + title, sized to fill the row ---
  const headerRow = sheet.getRow(1);
  headerRow.height = 60;
  for (let c = 1; c <= colWidths.length; c++) {
    sheet.getCell(1, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FOF_BLACK } };
  }
  sheet.mergeCells(1, 2, 1, colWidths.length);
  const titleCell = sheet.getCell(1, 2);
  titleCell.value = "FIGHT OR FLIGHT  \u2014  Team Logins";
  titleCell.font = { name: "Arial", bold: true, size: 16, color: { argb: FOF_RED } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };

  try {
    const logoPath = path.join(process.cwd(), "public", "logo.png");
    const logoBuffer = readFileSync(logoPath);
    const imageId = workbook.addImage({ buffer: logoBuffer as any, extension: "png" });
    // Sized to fill the header row's height (60pt \u2248 80px), anchored in column A.
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
    cell.font = { name: "Arial", bold: true, size: 11, color: { argb: FOF_PAPER } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FOF_CHARCOAL } };
  });
  headerLabelRow.height = 20;

  // --- Data rows, alternating banding ---
  const teamList = teams ?? [];
  teamList.forEach((t, i) => {
    const username = usernameByTeamId.get(t.id);
    const row = sheet.getRow(i + 3);
    const values = [
      t.id,
      t.team_name,
      t.athlete_1,
      t.athlete_2,
      t.wave,
      username ?? "(none yet)",
      username
        ? "(already set - can't be retrieved; use Edit on /admin to set a new one)"
        : "(no login yet - use the create form on /admin)",
    ];
    values.forEach((v, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      cell.value = v as any;
      cell.font = {
        name: "Arial",
        size: 10.5,
        color: { argb: username ? FOF_BLACK : FOF_RED },
        italic: colIdx === 6,
        bold: colIdx === 5,
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: i % 2 === 0 ? ROW_CREAM : ROW_WHITE },
      };
    });
  });

  sheet.views = [{ state: "frozen", ySplit: 2 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `fight-or-flight-team-logins-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
