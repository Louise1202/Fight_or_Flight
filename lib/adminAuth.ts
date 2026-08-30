import { createHash, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "admin_session";

function expectedToken(): string {
  return createHash("sha256")
    .update(process.env.ADMIN_PASSWORD || "")
    .digest("hex");
}

export function isValidAdminPassword(password: string): boolean {
  return password === process.env.ADMIN_PASSWORD;
}

export function adminCookieValue(): string {
  return expectedToken();
}

export function isAdminSession(): boolean {
  const cookie = cookies().get(COOKIE_NAME)?.value;
  if (!cookie) return false;
  const expected = expectedToken();
  // lengths must match for timingSafeEqual - bail out early if not
  if (cookie.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(cookie), Buffer.from(expected));
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
