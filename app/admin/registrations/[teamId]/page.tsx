import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEventById } from "@/lib/activeEvent";
import { TEAM_TYPES, formatEventDate } from "@/lib/events";
import {
  CONSENT_SECTIONS,
  FINAL_DECLARATION_SECTION,
  INJURIES_ANYTHING_ELSE,
  MEDICAL_ADDITIONAL,
  MEDICAL_QUESTIONS,
  ORGANISER,
  PHOTO_CONSENT,
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
  preferred_name: string | null;
  gender: string;
  date_of_birth: string | null;
  id_number: string | null;
  phone: string;
  email: string;
  address: string | null;
  country: string | null;
  emergency_name: string | null;
  emergency_phone: string | null;
  emergency_phone_alt: string | null;
  emergency_relationship: string | null;
  emergency_aware: boolean | null;
  photo_consent: boolean | null;
  legal_name: string | null;
  consents: { version?: string; accepted?: Record<string, boolean>; accepted_at?: string } | null;
  signature_png: string | null;
  signed_at: string | null;
};

type Medical = {
  member_id: number;
  answers: Record<string, string> | null;
  details: string | null;
  extra: {
    notes?: Record<string, string>;
    medical_aid?: { has?: boolean; provider?: string; number?: string };
    doctor?: { name?: string; phone?: string };
  } | null;
};

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

function yn(v: boolean | null | undefined) {
  return v === true ? "Yes" : v === false ? "No" : "-";
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
      {section.statements && (
        <ul className="space-y-1 pl-2">
          {section.statements.map((s, i) => (
            <li key={`s${i}`}>☐ {s}</li>
          ))}
        </ul>
      )}
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

  let teamId: string;
  try {
    teamId = decodeURIComponent(params.teamId);
  } catch {
    notFound();
  }
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
      "id, position, first_name, surname, preferred_name, gender, date_of_birth, id_number, phone, email, address, country, emergency_name, emergency_phone, emergency_phone_alt, emergency_relationship, emergency_aware, photo_consent, legal_name, consents, signature_png, signed_at"
    )
    .eq("team_id", teamId)
    .order("position", { ascending: true });
  const members = (memberRows ?? []) as Member[];
  const signedMembers = members.filter((m) => m.signed_at);

  const { data: medRows } = members.length
    ? await admin
        .from("member_medical")
        .select("member_id, answers, details, extra")
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
  const statusLabel = team.status === "registered" ? "Booked (waiting for a signature)" : team.status;

  // Medical questions answered, including any no longer on the current form.
  const questionKeys = [...MEDICAL_QUESTIONS.map((q) => q.key)];
  for (const r of medical.values()) {
    for (const k of Object.keys(r.answers ?? {})) if (!questionKeys.includes(k)) questionKeys.push(k);
  }
  const questionLabel = (k: string) => MEDICAL_QUESTIONS.find((q) => q.key === k)?.label ?? k;
  const noteLabels: [string, string][] = [
    ...MEDICAL_QUESTIONS.flatMap((q) => (q.detail ? [[q.detail.key, q.detail.label] as [string, string]] : [])),
    [INJURIES_ANYTHING_ELSE.key, INJURIES_ANYTHING_ELSE.label],
  ];

  return (
    <main className="print-page min-h-screen bg-white px-4 py-6 text-black sm:px-8">
      <PrintStyles />
      <div className="mx-auto max-w-3xl font-body">
        <PrintBar />

        <header className="border-b-2 border-black pb-3">
          <p className="text-xs uppercase tracking-widest text-gray-700">Athlete registration, medical information, consent &amp; participant waiver</p>
          <h1 className="font-display text-3xl tracking-wide">{event?.name ?? team.event_id}</h1>
          <p className="text-sm">
            {event ? formatEventDate(event.event_date) : ""}
            {event?.venue ? ` · ${event.venue}` : ""} · Organiser: {ORGANISER}
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
            <p className="text-xs text-gray-600">Category</p>
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
            <p className="capitalize">
              {statusLabel}
              {team.paid ? " · paid" : ""}
            </p>
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
              <h2 className="border-b border-black pb-1 font-display text-xl tracking-wide">Athlete information &amp; emergency contact</h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                {members.map((m) => (
                  <div key={m.id} className="avoid-break rounded border border-gray-400 p-3 text-sm">
                    <p className="text-xs uppercase tracking-widest text-gray-600">
                      Athlete {m.position} · {m.gender}
                    </p>
                    <p className="text-lg font-semibold">{name(m)}</p>
                    {!m.signed_at && <p className="text-sm font-semibold text-red-700">Not signed yet - waiting for this athlete to sign.</p>}
                    <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1">
                      <dt className="text-gray-600">Preferred name</dt>
                      <dd>{m.preferred_name || "-"}</dd>
                      <dt className="text-gray-600">Date of birth</dt>
                      <dd className="nums">{m.date_of_birth || "-"}</dd>
                      <dt className="text-gray-600">ID / passport</dt>
                      <dd className="nums">{m.id_number || "-"}</dd>
                      <dt className="text-gray-600">Mobile</dt>
                      <dd className="nums">{m.phone}</dd>
                      <dt className="text-gray-600">Email</dt>
                      <dd className="break-all">{m.email}</dd>
                      <dt className="text-gray-600">Address</dt>
                      <dd className="whitespace-pre-line">{m.address || "-"}</dd>
                      <dt className="text-gray-600">Country</dt>
                      <dd>{m.country || "-"}</dd>
                      <dt className="text-gray-600">Emergency</dt>
                      <dd>
                        {m.emergency_name || "-"}
                        {m.emergency_relationship ? ` (${m.emergency_relationship})` : ""}
                        <br />
                        <span className="nums">{m.emergency_phone || ""}</span>
                        {m.emergency_phone_alt ? (
                          <>
                            <br />
                            <span className="nums">Alt: {m.emergency_phone_alt}</span>
                          </>
                        ) : null}
                      </dd>
                      <dt className="text-gray-600">Contact aware</dt>
                      <dd>{yn(m.emergency_aware)}</dd>
                    </dl>
                  </div>
                ))}
              </div>
            </section>

            {/* Medical */}
            <section className="mt-6">
              <h2 className="border-b border-black pb-1 font-display text-xl tracking-wide">Medical information, injuries &amp; medical aid</h2>
              <p className="mt-1 text-xs text-gray-700">Confidential health information - for event safety and medical staff only.</p>
              {signedMembers.every((m) => !medical.has(m.id)) ? (
                <p className="mt-2 text-sm">
                  {signedMembers.length === 0
                    ? "No athlete has signed yet."
                    : "Medical answers are no longer on file (they are erased automatically 30 days after the event)."}
                </p>
              ) : (
                <>
                  <table className="mt-2 w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-black text-left">
                        <th className="py-1 pr-2 font-semibold">Question</th>
                        {members.map((m) => (
                          <th key={m.id} className="w-24 py-1 pr-2 font-semibold">
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
                  <div className="mt-3 space-y-3 text-sm">
                    {members.map((m) => {
                      const med = medical.get(m.id);
                      if (!med) return null;
                      const notes = med.extra?.notes ?? {};
                      const aid = med.extra?.medical_aid;
                      const doc = med.extra?.doctor;
                      return (
                        <div key={m.id} className="avoid-break rounded border border-gray-300 p-2">
                          <p className="font-semibold">{name(m)}</p>
                          {noteLabels.map(([k, label]) =>
                            notes[k] ? (
                              <p key={k}>
                                <span className="text-gray-600">{label}</span> <span className="whitespace-pre-line">{notes[k]}</span>
                              </p>
                            ) : null
                          )}
                          <p>
                            <span className="text-gray-600">{MEDICAL_ADDITIONAL.label}</span>{" "}
                            <span className="whitespace-pre-line">{med.details?.trim() || "None given"}</span>
                          </p>
                          <p>
                            <span className="text-gray-600">Medical aid / insurance:</span> {yn(aid?.has)}
                            {aid?.has ? ` · ${aid.provider || "-"} · ${aid.number || "-"}` : ""}
                          </p>
                          <p>
                            <span className="text-gray-600">Doctor:</span> {doc?.name || "-"}
                            {doc?.phone ? ` · ${doc.phone}` : ""}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </section>

            {/* Consents: one tick per section */}
            {CONSENT_SECTIONS.map((sec) => (
              <section key={sec.key} className="mt-6">
                <h2 className="border-b border-black pb-1 font-display text-xl tracking-wide">{sec.title}</h2>
                <div className="mt-2">
                  <LegalBlock section={sec} />
                </div>
                <div className="avoid-break mt-2 space-y-1 text-sm">
                  {members.map((m) => (
                    <p key={m.id}>
                      <TickCell ok={m.consents?.accepted?.[sec.key] === true} /> {name(m)} agrees to all of the above
                    </p>
                  ))}
                </div>
              </section>
            ))}

            <section className="avoid-break mt-6">
              <h2 className="border-b border-black pb-1 font-display text-xl tracking-wide">{PHOTO_CONSENT.title}</h2>
              <div className="mt-2 space-y-1 text-sm">
                {members.map((m) => (
                  <p key={m.id}>
                    <span className="font-semibold">{name(m)}:</span>{" "}
                    {m.photo_consent === true ? PHOTO_CONSENT.yes : m.photo_consent === false ? PHOTO_CONSENT.no : "-"}
                  </p>
                ))}
              </div>
            </section>

            {/* Final declaration */}
            <section className="mt-6">
              <h2 className="border-b border-black pb-1 font-display text-xl tracking-wide">{FINAL_DECLARATION_SECTION.title}</h2>
              <div className="mt-2">
                <LegalBlock section={FINAL_DECLARATION_SECTION} />
              </div>
              <div className="avoid-break mt-2 space-y-1 text-sm">
                {members.map((m) => (
                  <p key={m.id}>
                    <TickCell ok={m.consents?.accepted?.[FINAL_DECLARATION_SECTION.key] === true} /> {name(m)} agrees to all of the above
                  </p>
                ))}
              </div>
            </section>

            {/* Signatures */}
            <section className="avoid-break mt-6">
              <h2 className="border-b border-black pb-1 font-display text-xl tracking-wide">Electronic signature</h2>
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
                      <p className="flex h-[100px] items-end border-b border-black text-sm text-red-700">
                        {m.signed_at ? "No signature on file" : "Not signed yet"}
                      </p>
                    )}
                    <p className="mt-1 text-sm font-semibold">Full legal name: {m.legal_name || name(m)}</p>
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
