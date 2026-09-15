import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";

// Always dynamic - this hits the live database on every request and
// must never be statically pre-rendered at build time (a build-time DB
// call against real, ever-changing data is exactly what crashed the
// build once already).
export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { number: string } }
) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const number = Number(params.number);
  if (!Number.isInteger(number)) {
    return NextResponse.json({ error: "Invalid station number" }, { status: 400 });
  }

  const { name, isRun } = await req.json();
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean) {
    return NextResponse.json({ error: "A station name is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("stations")
    .update({ name: clean, is_run: !!isRun })
    .eq("number", number);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// Delete is only allowed for the LAST (highest-numbered) station, and
// only while nothing has been scanned there yet - the same append-only,
// guarded-delete pattern used for teams and heats elsewhere in /admin.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { number: string } }
) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const number = Number(params.number);
  if (!Number.isInteger(number)) {
    return NextResponse.json({ error: "Invalid station number" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: all, error: fetchErr } = await admin.from("stations").select("number");
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  const maxNumber = (all ?? []).reduce((max, s) => Math.max(max, s.number), 0);
  if (number !== maxNumber) {
    return NextResponse.json(
      { error: "Only the last station can be deleted - remove them from the end, one at a time" },
      { status: 409 }
    );
  }

  const { count, error: countErr } = await admin
    .from("scans")
    .select("id", { count: "exact", head: true })
    .eq("station_number", number);
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if (count && count > 0) {
    return NextResponse.json(
      { error: "Teams have already scanned at this station - it can't be removed" },
      { status: 409 }
    );
  }

  const { error } = await admin.from("stations").delete().eq("number", number);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
