import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";

// Add / remove heats (waves) directly in /admin, so an event can be built
// without an Excel import.
//
// Race-day control of a heat (start / end / undo / edit scheduled time)
// stays in /api/admin/waves - this route is only about the heat existing
// at all.

// Add a heat.
export async function POST(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { time, date } = await req.json();
  if (!/^\d{2}:\d{2}$/.test(time ?? "")) {
    return NextResponse.json(
      { error: "A time in HH:MM format is required" },
      { status: 400 }
    );
  }
  if (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "Date must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: existing, error: fetchErr } = await admin
    .from("waves")
    .select("wave_number, scheduled_start")
    .order("wave_number");
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  // Event date: use what was passed, otherwise borrow it from an existing
  // heat so every heat sits on the same day.
  const eventDate =
    date ??
    (existing && existing.length > 0
      ? String(existing[0].scheduled_start).slice(0, 10)
      : null);
  if (!eventDate) {
    return NextResponse.json(
      { error: "No heats exist yet - an event date is required" },
      { status: 400 }
    );
  }

  // Lowest positive integer not already in use, so removing a heat from
  // the middle and adding one back reuses that number.
  const used = new Set((existing ?? []).map((w) => w.wave_number));
  let waveNumber = 1;
  while (used.has(waveNumber)) waveNumber += 1;

  const row = {
    wave_number: waveNumber,
    scheduled_start: `${eventDate}T${time}:00`,
  };

  const { error } = await admin.from("waves").insert(row);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, wave: { ...row, actual_start: null, actual_end: null } });
}

// Remove a heat. Only allowed while it's empty and hasn't been started.
export async function DELETE(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { waveNumber } = await req.json();
  if (!Number.isInteger(waveNumber)) {
    return NextResponse.json({ error: "waveNumber is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: heat, error: heatErr } = await admin
    .from("waves")
    .select("wave_number, actual_start")
    .eq("wave_number", waveNumber)
    .maybeSingle();
  if (heatErr) return NextResponse.json({ error: heatErr.message }, { status: 500 });
  if (!heat) return NextResponse.json({ error: "Heat not found" }, { status: 404 });

  if (heat.actual_start) {
    return NextResponse.json(
      { error: "This heat has already been started - reopen/undo its start first." },
      { status: 409 }
    );
  }

  const { count } = await admin
    .from("teams")
    .select("id", { count: "exact", head: true })
    .eq("wave", waveNumber);
  if (count && count > 0) {
    return NextResponse.json(
      { error: `Heat ${waveNumber} still has ${count} team(s) - move or delete them first.` },
      { status: 409 }
    );
  }

  const { error } = await admin.from("waves").delete().eq("wave_number", waveNumber);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
