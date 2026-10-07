import { NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent } from "@/lib/activeEvent";
import { chunk, fetchAll } from "@/lib/fetchAll";
import type { EventRow } from "@/lib/events";

// Registrations of the ACTIVE event for the admin table. Contact details
// yes; medical answers and signatures never - only counts of them.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TeamRow = {
  id: string;
  team_name: string | null;
  division: string | null;
  status: string;
  paid: boolean;
  wave: number | null;
  registered_at: string | null;
};

type MemberRow = {
  id: number;
  team_id: string;
  position: number;
  first_name: string;
  surname: string;
  gender: string;
  phone: string;
  email: string;
  emergency_name: string;
  emergency_phone: string;
  emergency_relationship: string | null;
};

export type AdminRegistrationsResponse = {
  event: EventRow;
  teams: Array<
    TeamRow & {
      members: Array<Omit<MemberRow, "id" | "team_id">>;
      medicalFlags: number;
      signed: number;
    }
  >;
};

export async function GET() {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const event = await getActiveEvent(admin);

    const teams = await fetchAll<TeamRow>((from, to) =>
      admin
        .from("teams")
        .select("id, team_name, division, status, paid, wave, registered_at")
        .eq("event_id", event.id)
        .order("id", { ascending: true })
        .range(from, to)
    );

    const members: MemberRow[] = [];
    const signedMemberIds = new Set<number>();
    for (const ids of chunk(teams.map((t) => t.id))) {
      const rows = await fetchAll<MemberRow>((from, to) =>
        admin
          .from("team_members")
          .select(
            "id, team_id, position, first_name, surname, gender, phone, email, emergency_name, emergency_phone, emergency_relationship"
          )
          .in("team_id", ids)
          .order("id", { ascending: true })
          .range(from, to)
      );
      members.push(...rows);

      // Which members signed - ids only, never the image itself.
      const signed = await fetchAll<{ id: number }>((from, to) =>
        admin
          .from("team_members")
          .select("id")
          .in("team_id", ids)
          .not("signature_png", "is", null)
          .order("id", { ascending: true })
          .range(from, to)
      );
      signed.forEach((s) => signedMemberIds.add(s.id));
    }

    // Medical flags: counted here, answers never leave the server.
    const flagsByMember = new Map<number, number>();
    for (const ids of chunk(members.map((m) => m.id))) {
      const rows = await fetchAll<{ member_id: number; answers: Record<string, unknown> | null; details: string | null }>(
        (from, to) =>
          admin
            .from("member_medical")
            .select("member_id, answers, details")
            .in("member_id", ids)
            .order("member_id", { ascending: true })
            .range(from, to)
      );
      for (const r of rows) {
        let n = 0;
        for (const v of Object.values(r.answers ?? {})) if (v === "yes" || v === "unknown") n++;
        if ((r.details ?? "").trim()) n++;
        flagsByMember.set(r.member_id, n);
      }
    }

    const byTeam = new Map<string, MemberRow[]>();
    for (const m of members) {
      const list = byTeam.get(m.team_id) ?? [];
      list.push(m);
      byTeam.set(m.team_id, list);
    }

    const body: AdminRegistrationsResponse = {
      event,
      teams: teams.map((t) => {
        const ms = (byTeam.get(t.id) ?? []).sort((a, b) => a.position - b.position);
        return {
          id: t.id,
          team_name: t.team_name,
          division: t.division,
          status: t.status,
          paid: t.paid,
          wave: t.wave,
          registered_at: t.registered_at,
          members: ms.map((m) => ({
            position: m.position,
            first_name: m.first_name,
            surname: m.surname,
            gender: m.gender,
            phone: m.phone,
            email: m.email,
            emergency_name: m.emergency_name,
            emergency_phone: m.emergency_phone,
            emergency_relationship: m.emergency_relationship,
          })),
          medicalFlags: ms.reduce((sum, m) => sum + (flagsByMember.get(m.id) ?? 0), 0),
          signed: ms.filter((m) => signedMemberIds.has(m.id)).length,
        };
      }),
    };

    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("admin/registrations: load failed");
    return NextResponse.json({ error: "Could not load registrations. Please try again." }, { status: 500 });
  }
}
