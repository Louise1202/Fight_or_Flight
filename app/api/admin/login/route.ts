import { NextRequest, NextResponse } from "next/server";
import {
  isValidAdminPassword,
  createAdminSessionToken,
  ADMIN_COOKIE_NAME,
  ADMIN_SESSION_MAX_AGE_S,
} from "@/lib/adminAuth";
import { allowRequest, callerKey } from "@/lib/rateLimit";

// Always dynamic - this hits the live database on every request and
// must never be statically pre-rendered at build time (a build-time DB
// call against real, ever-changing data is exactly what crashed the
// build once already).
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // 10 tries per 15 minutes per device/network, counted before the check
  // so guessing is slow whether or not a guess is right.
  if (!(await allowRequest(callerKey(req, "admin-login"), 10, 15 * 60))) {
    return NextResponse.json(
      { error: "Too many attempts. Wait 15 minutes and try again." },
      { status: 429 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!isValidAdminPassword(body?.password)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, createAdminSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_MAX_AGE_S,
  });
  return res;
}
