import { NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { heatIdPrefix } from "@/lib/teamId";

export const dynamic = "force-dynamic";

type TeamRow = { id: string; team_name: string; wave: number | null };

function parsedNumber(name: string): number {
  const m = name.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
}

async function buildPlan() {
  const admin = createAdminClient();
  const [{ data: teams, error: teamsErr }, { data: waves, error: wavesErr }] = await Promise.all([
    admin.from("teams").select("id, team_name, wave"),
    admin.from("waves").select("wave_number, scheduled_start"),
  ]);
  if (teamsErr) throw new Error(teamsErr.message);
  if (wavesErr) throw new Error(wavesErr.message);

  const waveByNumber = new Map((waves ?? []).map((w) => [w.wave_number, w.scheduled_start]));

  const byWave = new Map<number, TeamRow[]>();
  const noWave: TeamRow[] = [];
  for (const t of (teams ?? []) as TeamRow[]) {
    if (t.wave == null || !waveByNumber.has(t.wave)) {
      noWave.push(t);
      continue;
    }
    const list = byWave.get(t.wave) ?? [];
    list.push(t);
    byWave.set(t.wave, list);
  }

  const plan: { oldId: string; newId: string; team_name: string; wave: number }[] = [];

  for (const [wave, group] of byWave) {
    // Position is decided by the number embedded in the team's name
    // (e.g. "Team 08" -> 8), NOT by the digits already in its id - the
    // existing ids are exactly what's unreliable here. Ties (or names
    // with no number) fall back to alphabetical order, so the result is
    // always deterministic even for a hand-added team with a custom name.
    const sorted = [...group].sort((a, b) => {
      const na = parsedNumber(a.team_name);
      const nb = parsedNumber(b.team_name);
      if (na !== nb) return na - nb;
      return a.team_name.localeCompare(b.team_name);
    });
    const prefix = heatIdPrefix(waveByNumber.get(wave)!);
    sorted.forEach((t, i) => {
      const newId = `${prefix}${String(i + 1).padStart(2, "0")}`;
      if (newId !== t.id) {
        plan.push({ oldId: t.id, newId, team_name: t.team_name, wave });
      }
    });
  }

  return { plan, orphaned: noWave.map((t) => ({ id: t.id, team_name: t.team_name, wave: t.wave })) };
}

export async function GET() {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  try {
    const result = await buildPlan();
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST() {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  let result;
  try {
    result = await buildPlan();
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
  const { plan } = result;

  if (plan.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 });
  }

  // Two-phase rename: every id in this plan first moves to a temporary,
  // guaranteed-unique placeholder, THEN every placeholder moves to its
  // real final id. Doing it in one pass risks a transient collision if
  // team A's old id happens to equal team B's new id mid-run - this
  // can't happen with a placeholder step in between.
  for (const p of plan) {
    const tempId = `TMP-${p.oldId}`;
    const { error } = await admin.from("teams").update({ id: tempId }).eq("id", p.oldId);
    if (error) return NextResponse.json({ error: `Phase 1 (${p.oldId}): ${error.message}` }, { status: 500 });
  }
  for (const p of plan) {
    const tempId = `TMP-${p.oldId}`;
    const { error } = await admin.from("teams").update({ id: p.newId }).eq("id", tempId);
    if (error) return NextResponse.json({ error: `Phase 2 (${p.oldId} -> ${p.newId}): ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated: plan.length });
}
