import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Always dynamic - this hits the live database on every request and
// must never be statically pre-rendered at build time (a build-time DB
// call against real, ever-changing data is exactly what crashed the
// build once already).
export const dynamic = "force-dynamic";

const HEAT_DURATION_MS = 60 * 60 * 1000;

// No admin session is required here - judges' phones call this while a
// heat is running, not just the admin. That's safe because the 60-minute
// cutoff is enforced by the WHERE clause below against the SERVER's
// clock, not anything the caller sends. Calling this before 60 minutes
// have actually passed (an early/buggy client, a manual replay, whatever)
// is just a no-op - it can only ever succeed once the real time has
// passed, and only once per heat (actual_end is null guard).
export async function POST(
  req: NextRequest,
  { params }: { params: { waveNumber: string } }
) {
  const waveNumber = Number(params.waveNumber);
  if (!Number.isInteger(waveNumber)) {
    return NextResponse.json({ error: "Invalid wave number" }, { status: 400 });
  }

  const cutoff = new Date(Date.now() - HEAT_DURATION_MS).toISOString();
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("waves")
    .update({ actual_end: new Date().toISOString() })
    .eq("wave_number", waveNumber)
    .is("actual_end", null)
    .not("actual_start", "is", null)
    .lt("actual_start", cutoff)
    .select("wave_number")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, closed: !!data });
}
