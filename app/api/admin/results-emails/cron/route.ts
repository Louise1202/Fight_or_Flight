import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, createHash } from "crypto";
import { isAdminSession } from "@/lib/adminAuth";
import { processResultEmails } from "@/lib/resultsEmail";

// Vercel Cron calls this every minute (vercel.json). It closes heats whose
// time limit has passed and sends any results emails that are due, for the
// ACTIVE event only. Also callable by a signed-in admin.
//
// It lives under /api/admin because middleware.ts lets /api/admin through
// without a Supabase login (these routes check their own access); a path
// like /api/cron would be redirected to /login and never run.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function cronAuthorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || !header) return false;
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!cronAuthorised(req) && !isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const summary = await processResultEmails(undefined, { budgetMs: 45000 });
  return NextResponse.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
}
