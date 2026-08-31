import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { scope } = await req.json();
  if (scope !== "race-data" && scope !== "full") {
    return NextResponse.json(
      { error: "scope must be 'race-data' or 'full'" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Always cleared: every scan, every penalty, and every heat's real
  // start/end - this is what "re-run the same event from zero" means.
  const { error: scansErr } = await admin.from("scans").delete().not("id", "is", null);
  if (scansErr) return NextResponse.json({ error: scansErr.message }, { status: 500 });

  const { error: penErr } = await admin.from("penalties").delete().not("id", "is", null);
  if (penErr) return NextResponse.json({ error: penErr.message }, { status: 500 });

  const { error: waveErr } = await admin
    .from("waves")
    .update({ actual_start: null, actual_end: null })
    .not("wave_number", "is", null);
  if (waveErr) return NextResponse.json({ error: waveErr.message }, { status: 500 });

  if (scope === "full") {
    // Children first, to satisfy foreign key constraints, and to collect
    // the auth user ids we need to delete before their owning rows go.
    const { error: assignErr } = await admin
      .from("judge_team_assignments")
      .delete()
      .not("judge_id", "is", null);
    if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });

    const { data: viewers } = await admin.from("team_viewers").select("id");
    const { error: viewersErr } = await admin.from("team_viewers").delete().not("id", "is", null);
    if (viewersErr) return NextResponse.json({ error: viewersErr.message }, { status: 500 });
    for (const v of viewers ?? []) {
      await admin.auth.admin.deleteUser(v.id).catch(() => {});
    }

    const { data: judges } = await admin.from("judges").select("id");
    const { error: judgesErr } = await admin.from("judges").delete().not("id", "is", null);
    if (judgesErr) return NextResponse.json({ error: judgesErr.message }, { status: 500 });
    for (const j of judges ?? []) {
      await admin.auth.admin.deleteUser(j.id).catch(() => {});
    }

    const { error: teamsErr } = await admin.from("teams").delete().not("id", "is", null);
    if (teamsErr) return NextResponse.json({ error: teamsErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, scope });
}
