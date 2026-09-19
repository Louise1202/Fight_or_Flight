import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";

// Always dynamic - this hits the live database on every request and
// must never be statically pre-rendered at build time (a build-time DB
// call against real, ever-changing data is exactly what crashed the
// build once already).
export const dynamic = "force-dynamic";

// Stations are always added at the end (number = current max + 1), never
// inserted in the middle - the "next station" logic everywhere else in
// the app relies on a plain, gapless 1..N sequence.
export async function POST(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { name, isRun } = await req.json();
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean) {
    return NextResponse.json({ error: "A station name is required" }, { status: 400 });
  }
  const isRunFlag = !!isRun;

  const admin = createAdminClient();
  const { data: existing, error: fetchErr } = await admin.from("stations").select("number");
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const nextNumber = (existing ?? []).reduce((max, s) => Math.max(max, s.number), 0) + 1;

  const { error } = await admin
    .from("stations")
    .insert({ number: nextNumber, name: clean, is_run: isRunFlag });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, station: { number: nextNumber, name: clean, isRun: isRunFlag } });
}
