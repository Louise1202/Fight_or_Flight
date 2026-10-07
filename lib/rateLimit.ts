// SERVER-ONLY. Counts attempts per key in the database (sql/019,
// hit_rate_limit) so the limit holds across every Vercel instance.
import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A stable, anonymous key for the caller - a hash of their IP address,
 * never the address itself (it isn't stored anywhere in readable form).
 */
export function callerKey(req: NextRequest, bucket: string): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const hash = createHash("sha256").update(`${bucket}:${ip}`).digest("hex").slice(0, 32);
  return `${bucket}:${hash}`;
}

/**
 * true = allowed. If the limiter itself can't be reached the request is
 * allowed (fail open) - a broken counter must never lock the admin out
 * on race day.
 */
export async function allowRequest(key: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("hit_rate_limit", {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}
