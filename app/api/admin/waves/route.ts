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
