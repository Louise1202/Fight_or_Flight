// SERVER-ONLY. The personal link the second athlete uses to complete the
// team's registration: "<Team ID>.<signature>", signed with a server
// secret so nobody can guess another team's link.
import { createHmac, timingSafeEqual } from "crypto";

function secret(): string {
  return `partner-sign:${process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "dev"}`;
}

export function signToken(teamId: string): string {
  const sig = createHmac("sha256", secret()).update(`${teamId}:2`).digest("base64url").slice(0, 32);
  return `${teamId}.${sig}`;
}

/** The Team ID if the link is genuine, otherwise null. */
export function teamIdFromSignToken(token: string | null | undefined): string | null {
  if (!token || !/^[A-Z]{2,4}\d{3,}\.[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const [teamId] = token.split(".");
  const a = Buffer.from(token);
  const b = Buffer.from(signToken(teamId));
  return a.length === b.length && timingSafeEqual(a, b) ? teamId : null;
}

export function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL || "https://race.betterdesk.app").replace(/\/+$/, "");
}

export function signUrl(teamId: string): string {
  return `${baseUrl()}/register/sign?t=${encodeURIComponent(signToken(teamId))}`;
}
