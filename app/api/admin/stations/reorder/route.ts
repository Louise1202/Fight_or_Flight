import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { order } = await req.json();
  if (!Array.isArray(order) || order.some((n) => !Number.isInteger(n))) {
    return NextResponse.json({ error: "order must be an array of station numbers" }, { status: 400 });
  }

  const admin = createAdminClient();

  // station_number isn't linked to scans by a foreign key, so reordering
  // can't be safely undone or cross-checked once any real timing data
  // exists - a recorded time would silently start meaning a different
  // exercise. Blocked entirely rather than guessed at per-station.
  const { count, error: countErr } = await admin
    .from("scans")
    .select("id", { count: "exact", head: true });
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if (count && count > 0) {
    return NextResponse.json(
      { error: "Can't reorder stations once any scan has been recorded - the course is locked in for this event." },
      { status: 409 }
    );
  }

  const { data: existing, error: fetchErr } = await admin.from("stations").select("number, name");
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const byNumber = new Map((existing ?? []).map((s) => [s.number, s.name]));
  if (order.length !== byNumber.size || order.some((n) => !byNumber.has(n))) {
    return NextResponse.json(
      { error: "That order doesn't match the current set of stations - refresh and try again." },
      { status: 400 }
    );
  }

  // Two-phase renumber so no station can ever collide with another
  // mid-run, whatever the requested order is.
  for (const n of order) {
    await admin.from("stations").update({ number: -n }).eq("number", n);
  }
  for (let i = 0; i < order.length; i++) {
    await admin.from("stations").update({ number: i + 1 }).eq("number", -order[i]);
  }

  return NextResponse.json({ ok: true });
}
