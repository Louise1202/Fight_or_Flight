import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";

// Starts a heat (sets actual_start = now).
export async function POST(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { waveNumber } = await req.json();
  if (!waveNumber) {
    return NextResponse.json({ error: "waveNumber is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("waves")
    .update({ actual_start: new Date().toISOString() })
    .eq("wave_number", waveNumber);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Manually ends a heat (sets actual_end = now). Normally this happens
// automatically the moment every team in the heat finishes - this is the
// fallback for a team that DNFs/withdraws and never crosses the finish
// line, since the automatic close can never fire for a heat that's
// permanently one team short.
export async function PATCH(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { waveNumber } = await req.json();
  if (!waveNumber) {
    return NextResponse.json({ error: "waveNumber is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("waves")
    .update({ actual_end: new Date().toISOString() })
    .eq("wave_number", waveNumber);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Undo - clears either the start or the end, in case of a mis-click.
export async function DELETE(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { waveNumber, field } = await req.json();
  if (!waveNumber) {
    return NextResponse.json({ error: "waveNumber is required" }, { status: 400 });
  }

  const column = field === "end" ? "actual_end" : "actual_start";
  const admin = createAdminClient();
  const { error } = await admin
    .from("waves")
    .update({ [column]: null })
    .eq("wave_number", waveNumber);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Edits the SCHEDULED time-of-day for a heat (the plan, not the real
// start - that only ever comes from pressing "Start Heat"). Keeps the
// existing event date, just changes the hour/minute.
export async function PUT(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { waveNumber, time } = await req.json();
  if (!waveNumber || !/^\d{2}:\d{2}$/.test(time ?? "")) {
    return NextResponse.json(
      { error: "waveNumber and a time in HH:MM format are required" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: existing, error: fetchErr } = await admin
    .from("waves")
    .select("scheduled_start")
    .eq("wave_number", waveNumber)
    .maybeSingle();

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Heat not found" }, { status: 404 });

  const datePart = String(existing.scheduled_start).slice(0, 10); // YYYY-MM-DD
  const newScheduledStart = `${datePart}T${time}:00`;

  const { error } = await admin
    .from("waves")
    .update({ scheduled_start: newScheduledStart })
    .eq("wave_number", waveNumber);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, scheduled_start: newScheduledStart });
}
