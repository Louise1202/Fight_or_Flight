// SERVER-ONLY helpers shared by the admin API routes. The leading
// underscore keeps this folder out of routing (it is not an endpoint).
import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent } from "@/lib/activeEvent";
import { EventRow, friendlyDbError } from "@/lib/events";

export type AdminClient = ReturnType<typeof createAdminClient>;

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export function fail(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function notAuthorized() {
  return fail("Not authorized", 401);
}

/** A database error turned into plain English - never the raw text. */
export function dbFail(
  error: { code?: string } | null | undefined,
  fallback: string,
  status = 500
) {
  const code = error?.code;
  const message = friendlyDbError(code, fallback);
  // Known rule violations are the caller's problem (409), not a crash.
  const s = code && (code.startsWith("RT") || code === "23505") ? 409 : status;
  return NextResponse.json({ error: message, code }, { status: s });
}

export const LOCKED_MESSAGE = "This event is finished and locked. Its results can't be changed.";

export function lockedFail() {
  return fail(LOCKED_MESSAGE, 409, { code: "RT001" });
}

/** The request body as a plain object, or null if it isn't valid JSON. */
export async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type EventSummary = EventRow & { teamCount: number };

export function isValidDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

/**
 * Checks the admin session and loads the active event. Returns either
 * a ready response (to return as-is) or the client + event.
 */
export async function adminContext(): Promise<
  { res: NextResponse; admin?: undefined; event?: undefined } | { res?: undefined; admin: AdminClient; event: EventRow }
> {
  if (!isAdminSession()) return { res: notAuthorized() };
  const admin = createAdminClient();
  try {
    const event = await getActiveEvent(admin);
    return { admin, event };
  } catch {
    return { res: fail("No event has been set up yet.", 500) };
  }
}

/** Whether any team of this event has a scan recorded. */
export async function eventHasScans(admin: AdminClient, eventId: string): Promise<boolean> {
  const { count, error } = await admin
    .from("scans")
    .select("id, teams!inner(event_id)", { count: "exact", head: true })
    .eq("teams.event_id", eventId);
  if (error) throw new Error("scan count failed");
  return (count ?? 0) > 0;
}

/** The team, only if it belongs to the given event. */
export async function teamInEvent(admin: AdminClient, teamId: string, eventId: string) {
  const { data, error } = await admin
    .from("teams")
    .select("id, team_name, wave, event_id, status")
    .eq("id", teamId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw new Error("team lookup failed");
  return data as { id: string; team_name: string; wave: number | null; event_id: string; status: string } | null;
}

/** Every auth user, fetched page by page once (not one call per user). */
export async function listAllAuthUsers(admin: AdminClient): Promise<{ id: string; email: string | null }[]> {
  const out: { id: string; email: string | null }[] = [];
  const perPage = 1000;
  for (let page = 1; page < 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error("user list failed");
    const users = data?.users ?? [];
    for (const u of users) out.push({ id: u.id, email: u.email ?? null });
    if (users.length < perPage) break;
  }
  return out;
}

export function emailToUsername(email: string | null | undefined): string {
  return email ? email.split("@")[0] : "(unknown)";
}

/** Plain-English message for a failed auth user create/update. */
export function authFail(error: { message?: string; status?: number } | null | undefined, fallback: string) {
  const msg = (error?.message ?? "").toLowerCase();
  if (msg.includes("already") || msg.includes("exists")) {
    return fail("That username is already taken - choose another one.", 409);
  }
  if (msg.includes("password")) {
    return fail("That password isn't accepted - try a longer one.", 400);
  }
  return fail(fallback, 400);
}
