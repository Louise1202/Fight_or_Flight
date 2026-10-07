import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

// The admin dashboard has its own password (ADMIN_PASSWORD), separate from
// Supabase Auth. A successful login gets a signed, expiring session token:
//   <expiry ms>.<random nonce>.<HMAC of both>
// - it expires on the server after 12 hours, not only in the browser
// - every login gets a different token
// - changing ADMIN_PASSWORD (or ADMIN_SESSION_SECRET) logs everyone out
// - with no ADMIN_PASSWORD set, nobody can log in at all

const COOKIE_NAME = "admin_session";
export const ADMIN_SESSION_MAX_AGE_S = 60 * 60 * 12; // covers race day

function sha256(v: string): Buffer {
  return createHash("sha256").update(v).digest();
}

function signingSecret(): string | null {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return null;
  return process.env.ADMIN_SESSION_SECRET || `session:${password}`;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function isValidAdminPassword(password: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof password !== "string" || password.length === 0) return false;
  // Hashing first gives equal-length buffers, so the compare is constant-time.
  return timingSafeEqual(sha256(password), sha256(expected));
}

export function createAdminSessionToken(): string {
  const secret = signingSecret();
  if (!secret) throw new Error("ADMIN_PASSWORD is not set");
  const payload = `${Date.now() + ADMIN_SESSION_MAX_AGE_S * 1000}.${randomBytes(12).toString("hex")}`;
  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(token: string | undefined): boolean {
  const secret = signingSecret();
  if (!secret || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [exp, nonce, sig] = parts;
  const expected = sign(`${exp}.${nonce}`, secret);
  if (sig.length !== expected.length) return false;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const expiry = Number(exp);
  return Number.isFinite(expiry) && expiry > Date.now();
}

export function isAdminSession(): boolean {
  return verifyToken(cookies().get(COOKIE_NAME)?.value);
}

export const ADMIN_COOKIE_NAME = COOKIE_NAME;
