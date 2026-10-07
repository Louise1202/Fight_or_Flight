import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveEvent } from "@/lib/activeEvent";
import { chunk, fetchAll } from "@/lib/fetchAll";
import { formatEventDate } from "@/lib/events";
import { MEDICAL_QUESTIONS } from "@/lib/legal/survivor";
import PrintBar, { PrintStyles } from "@/components/register/PrintBar";

// Every athlete in the ACTIVE event with a medical "Yes" / "Unknown" or
// written details, grouped by heat, for the medics on the day.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Medic sheet", robots: { index: false, follow: false } };

type TeamRow = { id: string; team_name: string | null; wave: number | null };
type MemberRow = {
  id: number;
  team_id: string;
  position: number;
  first_name: string;
  surname: string;
  gender: string;
  phone: string;
  emergency_name: string;
  emergency_phone: string;
  emergency_relationship: string | null;
};
type MedicalRow = { member_id: number; answers: Record<string, string> | null; details: string | null };

type Flagged = MemberRow & { team: TeamRow; flags: { label: string; answer: string }[]; details: string };

const PRINTED = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export default async function MedicSheetPage() {
  if (!isAdminSession()) redirect("/admin/login");

  const admin = createAdminClient();
  const event = await getActiveEvent(admin);

  const teams = await fetchAll<TeamRow>((from, to) =>
    admin
      .from("teams")
      .select("id, team_name, wave")
      .eq("event_id", event.id)
      .neq("status", "withdrawn")
      .order("id", { ascending: true })
      .range(from, to)
  );
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const members: MemberRow[] = [];
  for (const ids of chunk(teams.map((t) => t.id))) {
    const rows = await fetchAll<MemberRow>((from, to) =>
      admin
        .from("team_members")
        .select("id, team_id, position, first_name, surname, gender, phone, emergency_name, emergency_phone, emergency_relationship")
        .in("team_id", ids)
        .order("id", { ascending: true })
        .range(from, to)
    );
    members.push(...rows);
  }

  const medical = new Map<number, MedicalRow>();
  for (const ids of chunk(members.map((m) => m.id))) {
    const rows = await fetchAll<MedicalRow>((from, to) =>
      admin
        .from("member_medical")
        .select("member_id, answers, details")
        .in("member_id", ids)
        .order("member_id", { ascending: true })
        .range(from, to)
    );
    rows.forEach((r) => medical.set(r.member_id, r));
  }

  const { data: waveRows } = await admin
    .from("waves")
    .select("wave_number, scheduled_start")
    .eq("event_id", event.id);
  const waveStart = new Map<number, string | null>((waveRows ?? []).map((w) => [w.wave_number as number, w.scheduled_start as string | null]));

  const labelOf = (k: string) => MEDICAL_QUESTIONS.find((q) => q.key === k)?.label ?? k;
  const order = (k: string) => {
    const i = MEDICAL_QUESTIONS.findIndex((q) => q.key === k);
    return i === -1 ? 999 : i;
  };

  const flagged: Flagged[] = [];
  for (const m of members) {
    const med = medical.get(m.id);
    if (!med) continue;
    const flags = Object.entries(med.answers ?? {})
      .filter(([, a]) => a === "yes" || a === "unknown")
      .sort(([a], [b]) => order(a) - order(b))
      .map(([k, a]) => ({ label: labelOf(k), answer: a === "yes" ? "Yes" : "Unknown" }));
    const details = (med.details ?? "").trim();
    if (flags.length === 0 && !details) continue;
    const team = teamById.get(m.team_id);
    if (!team) continue;
    flagged.push({ ...m, team, flags, details });
  }

  // Group by heat; "No heat yet" last.
  const groups = new Map<number | null, Flagged[]>();
  for (const f of flagged) {
    const k = f.team.wave ?? null;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const keys = Array.from(groups.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });
  for (const k of keys) {
    groups.get(k)!.sort((a, b) => a.team.id.localeCompare(b.team.id) || a.position - b.position);
  }

  const heatTitle = (k: number | null) => {
    if (k === null) return "No heat yet";
    const start = waveStart.get(k);
    // Planned heat times are stored as wall-clock values in the UTC
    // fields (see lib/teamId.ts), so they are read back with getUTC*.
    if (!start) return `Heat ${k}`;
    const d = new Date(start);
    const hhmm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    return `Heat ${k} · starts ${hhmm}`;
  };

  return (
    <main className="print-page min-h-screen bg-white px-4 py-6 text-black sm:px-8">
      <PrintStyles />
      <div className="mx-auto max-w-5xl font-body">
        <PrintBar />

        <header className="border-b-2 border-black pb-3">
          <p className="rounded border-2 border-black px-3 py-2 text-sm font-semibold">
            Confidential health information - for event safety and medical staff only.
          </p>
          <h1 className="mt-3 font-display text-3xl tracking-wide">Medic sheet · {event.name}</h1>
          <p className="text-sm">
            {formatEventDate(event.event_date)}
            {event.venue ? ` · ${event.venue}` : ""} · {flagged.length} athlete{flagged.length === 1 ? "" : "s"} listed · printed{" "}
            {PRINTED.format(new Date())}
          </p>
          <p className="mt-1 text-xs text-gray-700">
            Lists every athlete who answered Yes or Unknown to a medical question, or wrote medical details. Withdrawn teams are left out.
          </p>
        </header>

        {flagged.length === 0 && (
          <p className="mt-6 rounded border border-black p-4 text-sm">No athlete has reported a medical condition so far.</p>
        )}

        {keys.map((k) => (
          <section key={String(k)} className="mt-6">
            <h2 className="border-b border-black pb-1 font-display text-xl tracking-wide">
              {heatTitle(k)} <span className="font-body text-sm font-normal">({groups.get(k)!.length})</span>
            </h2>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-black text-left align-bottom">
                  <th className="py-1 pr-3 font-semibold">Team</th>
                  <th className="py-1 pr-3 font-semibold">Athlete</th>
                  <th className="py-1 pr-3 font-semibold">Medical</th>
                  <th className="py-1 font-semibold">Emergency contact</th>
                </tr>
              </thead>
              <tbody>
                {groups.get(k)!.map((f) => (
                  <tr key={f.id} className="avoid-break border-b border-gray-300 align-top">
                    <td className="py-2 pr-3">
                      <span className="nums font-semibold">{f.team.id}</span>
                      <br />
                      <span className="text-xs">{f.team.team_name ?? ""}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <span className="font-semibold">
                        {f.first_name} {f.surname}
                      </span>
                      <br />
                      <span className="text-xs capitalize">{f.gender}</span>
                      <br />
                      <span className="nums text-xs">{f.phone}</span>
                    </td>
                    <td className="py-2 pr-3">
                      {f.flags.length > 0 && (
                        <ul className="space-y-0.5">
                          {f.flags.map((fl) => (
                            <li key={fl.label}>
                              <span className="font-semibold">{fl.answer}:</span> {fl.label}
                            </li>
                          ))}
                        </ul>
                      )}
                      {f.details && <p className="mt-1 whitespace-pre-line italic">“{f.details}”</p>}
                    </td>
                    <td className="py-2">
                      {f.emergency_name}
                      {f.emergency_relationship ? ` (${f.emergency_relationship})` : ""}
                      <br />
                      <span className="nums">{f.emergency_phone}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        <p className="mt-8 border-t border-gray-300 pt-2 text-[11px] text-gray-600">
          Destroy printed copies after the event. Medical answers are erased from the system automatically 30 days after the event.
        </p>
      </div>
    </main>
  );
}
