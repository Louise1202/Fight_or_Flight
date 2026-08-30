import { NextRequest, NextResponse } from "next/server";
import { isValidAdminPassword, adminCookieValue, ADMIN_COOKIE_NAME } from "@/lib/adminAuth";

export async function POST(req: NextRequest) {
  const { password } = await req.json();

  if (!isValidAdminPassword(password)) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, adminCookieValue(), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12 hours - long enough to cover race day
  });
  return res;
}
