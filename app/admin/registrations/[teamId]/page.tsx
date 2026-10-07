import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEventById } from "@/lib/activeEvent";
import { TEAM_TYPES, formatEventDate } from "@/lib/events";
import {
  CONSENT_SECTIONS,
  FINAL_DECLARATION,
  MEDICAL_QUESTIONS,
  WORDING_VERSION,
  type LegalSection,
} from "@/lib/legal/survivor";
import PrintBar, { PrintStyles } from "@/components/register/PrintBar";

// One team's signed registration, laid out to print or save as PDF.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Signed registration", robots: { index: false, follow: false } };

type Member = {
  id: number;
  position: number;
  first_name: string;
  surname: string;
  gender: string;
  phone: string;
  email: string;
  emergency_name: string;
  emergency_phone: string;
  emergency_relationship: string | null;
  consents: { version?: string; accepted?: Record<string, boolean>; accepted_at?: string } | null;
  signature_png: string | null;
  signed_at: string;
};

type Medical = { member_id: number; answers: Record<string, string> | null; details: string | null };

const SA_DATETIME = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function saTime(iso: string | null | undefined) {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : `${SA_DATETIME.format(d)} (SA time)`;
}

function answerLabel(a: string | undefined) {
  if (a === "yes") return "Yes";
  if (a === "no") return "No";
  if (a === "unknown") return "Unknown";
  return "-";
}

function LegalBlock({ section }: { section: LegalSection }) {
  return (
    <div className="space-y-2 text-[13px] leading-relaxed">
      {section.paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
      {section.bullets && (
        <ul className="list-disc pl-6">
          {section.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {section.closing?.map((p, i) => <p key={`c${i}`}>{p}</p>)}
    </div>
  );
}

function TickCell({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-block min-w-[6.5rem] font-semibold ${ok ? "text-black" : "text-red-700"}`}>
      {ok ? "☑ Accepted" : "☐ Not accepted"}
    </span>
  );
}

export default async function RegistrationPrintPage({ params }: { params: { teamId: string } }) {
  if (!isAdminSession()) redirect("/admin/login");

  const teamId = decodeURIComponent(params.teamId);
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(teamId)) notFound();

  const admin = createAdminClient();
  const { data: team } = await admin
    .from("teams")
    .select("id, event_id, team_name, division, status, wave, registered_at, paid")
    .eq("id", teamId)
    .maybeSingle();
  if (!team) notFound();

  const event = await getEventById(team.event_id, admin);
  const { data: memberRows } = await admin
    .from("team_members")
    .select(
      "id, position, first_name, surname, gender, phone, email, emergency_name, emergency_phone, emergency_relationship, consents, signature_png, signed_at"
    )
    .eq("team_id", teamId)
    .order("position", { ascending: true });
  const members = (memberRows ?? []) as Member[];

  const { data: medRows } = members.length
    ? await admin
        .from("member_medical")
        .select("member_id, answers, details")
        .in(
          "member_id",
          members.map((m) => m.id)
        )
    : { data: [] as Medical[] };
  const medical = new Map<number, Medical>(((medRows ?? []) as Medical[]).map((r) => [r.member_id, r]));

  const divisionLabel = TEAM_TYPES.find((t) => t.division === team.division)?.label;
  const versions = Array.from(new Set(members.map((m) => m.consents?.version).filter(Boolean))) as string[];
  const oldWording = versions.some((v) => v !== WORDING_VERSION);
  const name = (m: Member) => `${m.first_name} ${m.surname}`;

  // Medical questions answered, including any no longer on the current form.
  const questionKeys = [...MEDICAL_QUESTIONS.map((q) => q.key)];
  for (const r of medical.values()) {
    for (const k of Object.keys(r.answers ?? {})) if (!questionKeys.includes(k)) questionKeys.push(k);
  }
  const questionLabel = (k: string) => MEDICAL_QUESTIONS.find((q) => q.key === k)?.label ?? k;

  return (
    <main className="print-page min-h-screen bg-white px-4 py-6 text-black sm:px-8">
      <PrintStyles />
      <div className="mx-auto max-w-3xl font-body">
        <PrintBar />

        <header className="border-b-2 border-black pb-3">
          <p className="text-xs uppercase tracking-widest text-gray-700">Signed team registration</p>
          <h1 className="font-display text-3xl tracking-wide">{event?.name ?? team.event_id}</h1>
          <p className="text-sm">
            {event ? formatEventDate(event.event_date) : ""}
            {event?.venue ? ` · ${event.venue}` : ""}
          </p>
        </header>

        <section className="avoid-break mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-gray-600">Team ID</p>
            <p className="nums text-2xl font-semibold">{team.id}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600">Team name</p>
            <p className="font-semibold">{team.team_name ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600">Division</p>
            <p className="font-semibold">
              {team.division ?? "-"}
              {divisionLabel ? ` (${divisionLabel})` : ""}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-600">Registered</p>
            <p>{saTime(team.registered_at)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600">Status</p>
            <p className="capitalize">{team.status}{team.paid ? " · paid" : ""}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600">Heat</p>
            <p>{team.wave ?? "No heat yet"}</p>
          </div>
          <div className="col-span-2">
            <p className="text-xs text-gray-600">Wording version</p>
            <p className="nums">{versions.length ? versions.join(", ") : "-"}</p>
          </div>
        </section>

        {members.length === 0 && (
          <p className="mt-6 rounded border border-black p-4 text-sm">
            This team was not registered through the online form, so there is no signed registration on file.
          </p>
        )}

        {members.length > 0 && (
          <>
            {oldWording && (
              <p className="mt-4 rounded border border-black p-3 text-xs">
                Note: this team signed wording version {versions.join(", ")}. The text shown below is the current version (
                {WORDING_VERSION}).
              </p>
            )}

            {/* Athletes */}
            <section className="mt-6">
              <h2 className="border-b border-black pb-1 font-display text-xl tracking-wide">Athletes</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {members.map((m) => (
                  <div key={m.id} className="avoid-break rounded border border-gray-400 p-3 text-sm">
                    <p className="text-xs uppercase tracking-widest text-gray-600">
                      Athlete {m.position} · {m.gender}
                    </p>
                    <p className="text-lg font-semibold">{name(m)}</p>
                    <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-1">
                      <dt className="text-gray-600">Phone</dt>
                      <dd className="nums">{m.phone}</dd>
                      <dt className="text-gray-600">Email</dt>
                      <dd className="break-all">{m.email}</dd>
                      <dt className="text-gray-600">Emergency</dt>
                      <dd>
                        {m.emergency_name}
                        {m.emergency_relationship ? ` (${m.emergency_relationship})` : ""}
                        <br />
                        <span className="nums">{m.emergency_phone}</span>
                      </dd>
                    </dl>
                  </div>
                ))}
              </div>
            </section>

            {/* Medical */}
            <section className="avoid-break mt-6">
              <h2 className="border-b border-black pb-1 font-display text-xl tracking-wide">Medical information</h2>
              <p className="mt-1 text-xs text-gray-700">Confidential health information - for event safety and medical staff only.</p>
              {members.every((m) => !medical.has(m.id)) ? (
                <p className="mt-2 text-sm">Medical answers are no longer on file (they are erased automatically 30 days after the event).</p>
              ) : (
                <table className="mt-2 w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-black text-left">
                      <th className="py-1 pr-2 font-semibold">Question</th>
                      {members.map((m) => (
                        <th key={m.id} className="w-28 py-1 pr-2 font-semibold">
                          {m.first_name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {questionKeys.map((k) => (
                      <tr key={k} className="border-b border-gray-300">
                        <td className="py-1 pr-2">{questionLabel(k)}</td>
                        {members.map((m) => {
                          const a = medical.get(m.id)?.answers?.[k];
                          return (
                            <td key={m.id} className={`py-1 pr-2 ${a === "yes" || a === "unknown" ? "font-semibold" : ""}`}>
                              {answerLabel(a)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="mt-2 space-y-1 text-sm">
                {members.map((m) => (
                  <p key={m.id}>
                    <span className="font-semibold">Details, {m.first_name}:</span>{" "}
                    <span className="whitespace-pre-line">{medical.get(m.id)?.details?.trim() || "None given"}</span>
                  </p>
                ))}
              </div>
            </section>

            {/* Consents */}
            {CONSENT_SECTIONS.map((sec) => (
              <section key={sec.key} className="mt-6">
                <h2 className="border-b border-black pb-1 font-display text-xl tracking-wide">{sec.title}</h2>
                <div className="mt-2">
                  <LegalBlock section={sec} />
                </div>
                <div className="avoid-break mt-2 space-y-1 text-sm">
                  {members.map((m) => (
                    <p key={m.id}>
                      <TickCell ok={m.consents?.accepted?.[sec.key] === true} /> {name(m)} has read and accepts this section
                    </p>
                  ))}
                </div>
              </section>
            ))}

            {/* Final declaration */}
            <section className="mt-6">
              <h2 className="border-b border-black pb-1 font-display text-xl tracking-wide">Final declaration</h2>
              <ol className="mt-2 space-y-3 text-sm">
                {FINAL_DECLARATION.map((d, n) => (
                  <li key={d.key} className="avoid-break">
                    <p>
                      {n + 1}. {d.text}
                    </p>
                    <div className="mt-1 space-y-0.5 pl-4">
                      {members.map((m) => (
                        <p key={m.id}>
                          <TickCell ok={m.consents?.accepted?.[d.key] === true} /> {name(m)}
                        </p>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {/* Signatures */}
            <section className="avoid-break mt-6">
              <h2 className="border-b border-black pb-1 font-display text-xl tracking-wide">Signatures</h2>
              <div className="mt-3 grid gap-6 sm:grid-cols-2">
                {members.map((m) => (
                  <div key={m.id} className="avoid-break">
                    {m.signature_png && m.signature_png.startsWith("data:image/png;base64,") ? (
                      <img
                        src={m.signature_png}
                        alt={`Signature of ${name(m)}`}
                        className="h-[100px] w-[300px] max-w-full border-b border-black object-contain"
                      />
                    ) : (
                      <p className="flex h-[100px] items-end border-b border-black text-sm text-red-700">No signature on file</p>
                    )}
                    <p className="mt-1 text-sm font-semibold">{name(m)}</p>
                    <p className="text-xs">Signed on {saTime(m.consents?.accepted_at ?? m.signed_at)}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        <p className="mt-8 border-t border-gray-300 pt-2 text-[11px] text-gray-600">
          Printed from the race-timing admin. Contains personal and health information - store securely and share only with people who need it.
        </p>
      </div>
    </main>
  );
}
