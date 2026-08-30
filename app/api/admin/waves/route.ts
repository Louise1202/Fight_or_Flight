import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";

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

// Undo, in case a heat is started by mistake (e.g. wrong button pressed).
export async function DELETE(req: NextRequest) {
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
    .update({ actual_start: null })
    .eq("wave_number", waveNumber);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
