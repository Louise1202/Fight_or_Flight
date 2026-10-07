"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import PasswordInput from "@/components/PasswordInput";
import { TEAM_TYPES, type Brand, type Division } from "@/lib/events";
import {
  CONSENT_SECTIONS,
  FINAL_DECLARATION_SECTION,
  IMPORTANT_INFO,
  INJURIES_ANYTHING_ELSE,
  INJURIES_TITLE,
  MEDICAL_ADDITIONAL,
  MEDICAL_AID,
  MEDICAL_INTRO,
  MEDICAL_QUESTIONS,
  ORGANISER,
  PHOTO_CONSENT,
  type LegalSection,
  type MedicalAnswer,
} from "@/lib/legal/survivor";
import {
  ADDRESS_MAX,
  DETAILS_MAX,
  EMAIL_MAX,
  ID_MAX,
  NAME_MAX,
  PASSWORD_MAX,
  RELATIONSHIP_MAX,
  SHORT_MAX,
  TEAM_NAME_MAX,
  cleanDateOfBirth,
  cleanEmail,
  cleanIdNumber,
  cleanPersonName,
  cleanRelationship,
  cleanTeamName,
  cleanText,
  isReservedTeamName,
  normaliseAnyPhone,
  passwordProblem,
  teamNameKey,
} from "@/components/register/rules";
import EventHeader, { type PublicEvent } from "@/components/register/EventHeader";
import SignaturePad from "@/components/register/SignaturePad";
import { Booked, Confirmation, type RegisterResult } from "@/components/register/Confirmation";

// ---------------------------------------------------------------------
// Types and helpers
// ---------------------------------------------------------------------

type Step = 1 | 2 | 3 | 4;

type Athlete = {
  first_name: string;
  surname: string;
  preferred_name: string;
  date_of_birth: string;
  id_number: string;
  phone: string;
  email: string;
  address: string;
  country: string;
  emergency_name: string;
  emergency_relationship: string;
  emergency_phone: string;
  emergency_phone_alt: string;
  emergency_aware: "" | "yes" | "no";
};

const EMPTY_ATHLETE: Athlete = {
  first_name: "",
  surname: "",
  preferred_name: "",
  date_of_birth: "",
  id_number: "",
  phone: "",
  email: "",
  address: "",
  country: "South Africa",
  emergency_name: "",
  emergency_relationship: "",
  emergency_phone: "",
  emergency_phone_alt: "",
  emergency_aware: "",
};

type Health = {
  answers: Record<string, MedicalAnswer | undefined>;
  notes: Record<string, string>;
  medical_aid: "" | "yes" | "no";
  medical_aid_provider: string;
  medical_aid_number: string;
  doctor_name: string;
  doctor_phone: string;
};

const EMPTY_HEALTH: Health = {
  answers: {},
  notes: {},
  medical_aid: "",
  medical_aid_provider: "",
  medical_aid_number: "",
  doctor_name: "",
  doctor_phone: "",
};

/** The second athlete completing the team's registration from their email link. */
export type PartnerInfo = {
  token: string;
  teamId: string;
  teamName: string;
  division: Division;
  bookerName: string;
  first_name: string;
  surname: string;
  phone: string;
  email: string;
};

type Pair<T> = [T, T];
type Errors = Record<string, string>;
type NameStatus = "idle" | "checking" | "taken" | "available" | "reserved" | "invalid";
type Idx = 0 | 1;

const SA_TIME = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** DOM id for an error key ("m0.first_name" -> "f-m0-first_name"). */
function fid(key: string) {
  return `f-${key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function genderOf(division: Division | null, i: Idx): "male" | "female" | null {
  const t = TEAM_TYPES.find((x) => x.division === division);
  return t ? t.genders[i] : null;
}

function fullName(a: Athlete, i: number) {
  const n = `${a.first_name.trim()} ${a.surname.trim()}`.trim();
  return n || `Athlete ${i + 1}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------

function FieldError({ id, msg }: { id: string; msg?: string }) {
  if (!msg) return null;
  return (
    <p id={`${id}-err`} className="mt-1 text-sm text-fofRed">
      {msg}
    </p>
  );
}

function TextField({
  errKey,
  label,
  value,
  onChange,
  error,
  type = "text",
  inputMode,
  autoComplete,
  maxLength,
  hint,
  optional,
  autoCapitalize,
  readOnly,
  max,
}: {
  errKey: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  maxLength?: number;
  hint?: string;
  optional?: boolean;
  autoCapitalize?: string;
  readOnly?: boolean;
  max?: string;
}) {
  const id = fid(errKey);
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-fofPaper">
        {label}
        {optional && <span className="text-fofGunmetal"> (optional)</span>}
      </label>
      <input
        id={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
        max={max}
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`tap-target w-full rounded-md border bg-transparent px-4 text-lg text-fofPaper ${
          error ? "border-fofRed" : "border-fofGunmetal"
        } ${readOnly ? "opacity-70" : ""}`}
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-fofGunmetal">
          {hint}
        </p>
      )}
      <FieldError id={id} msg={error} />
    </div>
  );
}

function TextArea({
  errKey,
  label,
  value,
  onChange,
  error,
  hint,
  optional,
  maxLength = DETAILS_MAX,
  rows = 3,
  autoComplete = "off",
}: {
  errKey: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
  maxLength?: number;
  rows?: number;
  autoComplete?: string;
}) {
  const id = fid(errKey);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-fofPaper">
        {label}
        {optional && <span className="text-fofGunmetal"> (optional)</span>}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="mb-1 text-xs text-fofGunmetal">
          {hint}
        </p>
      )}
      <textarea
        id={id}
        rows={rows}
        maxLength={maxLength}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined}
        className={`w-full rounded-md border bg-transparent px-4 py-3 text-lg text-fofPaper ${error ? "border-fofRed" : "border-fofGunmetal"}`}
      />
      <FieldError id={id} msg={error} />
    </div>
  );
}

/** A row of 2-3 big buttons, one of which can be chosen. */
function Choice<T extends string>({
  errKey,
  label,
  value,
  options,
  onChange,
  error,
}: {
  errKey: string;
  label: string;
  value: T | "" | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  error?: string;
}) {
  const id = fid(errKey);
  const labelId = `${id}-label`;
  return (
    <div>
      <p id={labelId} className={`mb-2 text-[15px] leading-snug ${error ? "text-fofRed" : "text-fofPaper"}`}>
        {label}
      </p>
      <div
        id={id}
        tabIndex={-1}
        role="radiogroup"
        aria-labelledby={labelId}
        aria-invalid={error ? true : undefined}
        className={`grid overflow-hidden rounded-md border outline-none ${error ? "border-fofRed" : "border-fofGunmetal"}`}
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o, k) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={`tap-target text-base font-semibold ${k > 0 ? "border-l border-fofGunmetal" : ""} ${
                on ? "bg-fofRed text-white" : "bg-transparent text-fofPaper"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <FieldError id={id} msg={error} />
    </div>
  );
}

const NO_YES_UNKNOWN = [
  { value: "no" as const, label: "No" },
  { value: "yes" as const, label: "Yes" },
  { value: "unknown" as const, label: "Unknown" },
];

function Tick({
  id,
  checked,
  onChange,
  children,
  error,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={`flex min-h-[56px] cursor-pointer items-center gap-3 rounded-md border px-4 py-3 ${
        checked ? "border-fofRed bg-fofCharcoal" : error ? "border-fofRed" : "border-fofRule"
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-invalid={error ? true : undefined}
        className="h-6 w-6 shrink-0"
        style={{ accentColor: "var(--fof-red)" }}
      />
      <span className="text-base leading-snug text-fofPaper">{children}</span>
    </label>
  );
}

function PersonIcon({ gender }: { gender: "male" | "female" }) {
  return (
    <svg width="22" height="36" viewBox="0 0 22 36" aria-hidden="true" fill="currentColor">
      <circle cx="11" cy="5" r="4.5" />
      {gender === "male" ? (
        <path d="M4 12h14a2 2 0 0 1 2 2v9h-3v12h-4V25h-4v10H5V23H2v-9a2 2 0 0 1 2-2z" />
      ) : (
        <path d="M7 12h8l5.5 14H16v9h-3.5v-9h-3v9H6v-9H1.5z" />
      )}
    </svg>
  );
}

/** A section of the waiver. Statements are always shown in full: they are what the tick agrees to. */
function LegalText({ section, number }: { section: LegalSection; number?: number }) {
  const [open, setOpen] = useState(false);
  const allParas = section.paragraphs;
  const shownParas = open ? allParas : allParas.slice(0, 2);
  const hasMore = allParas.length > 2 || (section.bullets?.length ?? 0) > 0 || (section.closing?.length ?? 0) > 0;
  const bodyId = `legal-${section.key}`;
  return (
    <div className="rounded-lg border border-fofRule bg-fofPanel p-4">
      <h3 className="font-display text-xl tracking-wide text-fofPaper">
        {number ? <span className="nums mr-2 text-fofGunmetal">{number}.</span> : null}
        {section.title}
      </h3>
      {(shownParas.length > 0 || hasMore) && (
        <div id={bodyId} className="mt-2 space-y-3 text-[15px] leading-relaxed text-fofPaper">
          {shownParas.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {open && section.bullets && (
            <ul className="list-disc space-y-1 pl-6">
              {section.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
          {open && section.closing?.map((p, i) => <p key={`c${i}`}>{p}</p>)}
        </div>
      )}
      {hasMore && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="tap-target mt-2 w-full rounded-md border border-fofGunmetal text-sm text-fofPaper hover:border-fofRed"
        >
          {open ? "Show less" : "Read in full"}
        </button>
      )}
      {section.statements && (
        <ul className="mt-3 space-y-2 border-t border-fofRule pt-3 text-[15px] leading-snug text-fofPaper">
          {section.statements.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="text-fofRed">
                ☐
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------

export default function RegistrationForm({
  event,
  brand,
  partner,
}: {
  event: PublicEvent;
  brand: Brand;
  /** Set when the second athlete completes the team's registration from their link. */
  partner?: PartnerInfo;
}) {
  const isPartner = !!partner;
  const [step, setStep] = useState<Step>(1);
  const [errors, setErrors] = useState<Errors>({});
  const [summary, setSummary] = useState<string | null>(null);

  // Step 1
  const [division, setDivision] = useState<Division | null>(partner?.division ?? null);
  const [teamName, setTeamName] = useState("");
  const [athletes, setAthletes] = useState<Pair<Athlete>>(() => [
    { ...EMPTY_ATHLETE },
    partner
      ? { ...EMPTY_ATHLETE, first_name: partner.first_name, surname: partner.surname, phone: partner.phone, email: partner.email }
      : { ...EMPTY_ATHLETE },
  ]);
  /** Team sign-up only: does athlete 2 sign later from an email link? */
  const [partnerLater, setPartnerLater] = useState(true);
  const [website, setWebsite] = useState(""); // honeypot

  // Step 2
  const [health, setHealth] = useState<Pair<Health>>([{ ...EMPTY_HEALTH }, { ...EMPTY_HEALTH }]);

  // Step 3
  const [consents, setConsents] = useState<Pair<Record<string, boolean>>>([{}, {}]);
  const [photo, setPhoto] = useState<Pair<"" | "yes" | "no">>(["", ""]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Step 4
  const [declared, setDeclared] = useState<Pair<boolean>>([false, false]);
  const [legalName, setLegalName] = useState<Pair<string>>(["", ""]);
  const [signatures, setSignatures] = useState<Pair<string | null>>([null, null]);
  const [signedAt, setSignedAt] = useState<Pair<Date | null>>([null, null]);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<RegisterResult | null>(null);

  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  /** Athletes who fill in and sign everything on this phone. */
  const people: Idx[] = isPartner ? [1] : partnerLater ? [0] : [0, 1];

  // ---------------- Team names already taken ----------------
  const [takenNames, setTakenNames] = useState<string[]>([]);
  const [showAllNames, setShowAllNames] = useState(false);
  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");
  const lastNamesFetch = useRef(0);
  const nameReq = useRef(0);

  const loadNames = useCallback(
    async (maxAgeMs: number): Promise<string[] | null> => {
      if (isPartner) return null;
      if (Date.now() - lastNamesFetch.current < maxAgeMs) return null;
      try {
        const res = await fetch(`/api/register/names?eventId=${encodeURIComponent(event.id)}`, { cache: "no-store" });
        if (!res.ok) return null;
        const json = (await res.json()) as { names?: unknown };
        const names = Array.isArray(json.names) ? json.names.filter((n): n is string => typeof n === "string") : [];
        lastNamesFetch.current = Date.now();
        setTakenNames(names);
        return names;
      } catch {
        return null;
      }
    },
    [event.id, isPartner]
  );

  useEffect(() => {
    loadNames(0);
  }, [loadNames]);

  const takenRef = useRef<string[]>([]);
  takenRef.current = takenNames;

  useEffect(() => {
    const cleaned = cleanTeamName(teamName);
    const key = teamNameKey(teamName);
    if (!key) {
      setNameStatus("idle");
      return;
    }
    if (cleaned === null) {
      setNameStatus("invalid");
      return;
    }
    if (isReservedTeamName(cleaned)) {
      setNameStatus("reserved");
      return;
    }
    setNameStatus("checking");
    const req = ++nameReq.current;
    const t = setTimeout(async () => {
      const fresh = await loadNames(10_000);
      if (req !== nameReq.current) return;
      const list = fresh ?? takenRef.current;
      setNameStatus(list.some((n) => teamNameKey(n) === key) ? "taken" : "available");
    }, 400);
    return () => clearTimeout(t);
  }, [teamName, loadNames]);

  // ---------------- Leaving the page with unsaved data ----------------
  const dirty =
    !result && (isPartner ? athletes[1].date_of_birth !== "" || athletes[1].id_number !== "" : division !== null || athletes[0].first_name !== "" || teamName !== "");
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ---------------- Update helpers ----------------
  function setPair<T>(setter: React.Dispatch<React.SetStateAction<Pair<T>>>, i: Idx, value: T | ((prev: T) => T)) {
    setter((prev) => {
      const next = [...prev] as Pair<T>;
      next[i] = typeof value === "function" ? (value as (p: T) => T)(prev[i]) : value;
      return next;
    });
  }

  function clearError(key: string) {
    setErrors((e) => {
      if (!(key in e)) return e;
      const n = { ...e };
      delete n[key];
      return n;
    });
  }

  function setAthleteField(i: Idx, field: keyof Athlete, v: string) {
    setPair(setAthletes, i, (a) => ({ ...a, [field]: v }));
    clearError(`m${i}.${field}`);
  }

  function setHealthField(i: Idx, field: Exclude<keyof Health, "answers" | "notes">, v: string) {
    setPair(setHealth, i, (h) => ({ ...h, [field]: v }));
    clearError(`m${i}.${field}`);
  }

  function setNote(i: Idx, key: string, v: string) {
    setPair(setHealth, i, (h) => ({ ...h, notes: { ...h.notes, [key]: v } }));
    clearError(`m${i}.note.${key}`);
  }

  const names: Pair<string> = [fullName(athletes[0], 0), fullName(athletes[1], 1)];
  const partnerFirst = athletes[1].first_name.trim() || "Athlete 2";

  // ---------------- Validation per step ----------------
  function validate(s: Step): Errors {
    const e: Errors = {};
    if (s === 1) {
      if (!isPartner) {
        if (!division) e.division = "Choose your team type.";
        const tn = cleanTeamName(teamName);
        if (tn === null) e.team_name = `Use at most ${TEAM_NAME_MAX} characters, without < or >.`;
        else if (tn && isReservedTeamName(tn))
          e.team_name = `Names like “Team ${event.team_id_prefix}001” are kept for teams without a name. Try another name.`;
        else if (tn && takenNames.some((n) => teamNameKey(n) === teamNameKey(tn))) e.team_name = `“${tn}” is already taken. Try another name.`;
      }
      const shown: Idx[] = isPartner ? [1] : [0, 1];
      shown.forEach((i) => {
        const a = athletes[i];
        if (!a.first_name.trim()) e[`m${i}.first_name`] = "Enter a first name.";
        else if (!cleanPersonName(a.first_name)) e[`m${i}.first_name`] = "Use letters, spaces, apostrophes or hyphens only.";
        if (!a.surname.trim()) e[`m${i}.surname`] = "Enter a surname.";
        else if (!cleanPersonName(a.surname)) e[`m${i}.surname`] = "Use letters, spaces, apostrophes or hyphens only.";
        if (!normaliseAnyPhone(a.phone)) e[`m${i}.phone`] = "Enter a number like 082 123 4567 or +27 82 123 4567.";
        if (!cleanEmail(a.email)) e[`m${i}.email`] = "Enter a valid email address.";
      });
      if (!isPartner && cleanEmail(athletes[0].email) && cleanEmail(athletes[0].email) === cleanEmail(athletes[1].email)) {
        e["m1.email"] = "Each athlete needs their own email address.";
      }
      people.forEach((i) => {
        const a = athletes[i];
        if (cleanText(a.preferred_name, NAME_MAX) === null) e[`m${i}.preferred_name`] = `Use at most ${NAME_MAX} characters.`;
        if (!cleanDateOfBirth(a.date_of_birth)) e[`m${i}.date_of_birth`] = "Enter a valid date of birth.";
        if (!cleanIdNumber(a.id_number)) e[`m${i}.id_number`] = "Enter a 13-digit ID number or a passport number.";
        if (!cleanText(a.address, ADDRESS_MAX)) e[`m${i}.address`] = "Enter your residential address.";
        if (!cleanText(a.country, SHORT_MAX)) e[`m${i}.country`] = "Enter your country of residence.";
        if (!a.emergency_name.trim()) e[`m${i}.emergency_name`] = "Enter the name of someone we can call in an emergency.";
        else if (!cleanPersonName(a.emergency_name)) e[`m${i}.emergency_name`] = "Use letters, spaces, apostrophes or hyphens only.";
        if (!a.emergency_relationship.trim()) e[`m${i}.emergency_relationship`] = "Enter the relationship, like Mother or Partner.";
        else if (!cleanRelationship(a.emergency_relationship)) e[`m${i}.emergency_relationship`] = "Use letters only, like Mother or Partner.";
        if (!normaliseAnyPhone(a.emergency_phone)) e[`m${i}.emergency_phone`] = "Enter a number like 082 123 4567.";
        else if (normaliseAnyPhone(a.emergency_phone) === normaliseAnyPhone(a.phone))
          e[`m${i}.emergency_phone`] = "Use someone else's number - not the athlete's own.";
        if (a.emergency_phone_alt.trim() && !normaliseAnyPhone(a.emergency_phone_alt))
          e[`m${i}.emergency_phone_alt`] = "Enter a number like 082 123 4567, or leave it blank.";
        if (!a.emergency_aware) e[`m${i}.emergency_aware`] = "Choose Yes or No.";
      });
    }
    if (s === 2) {
      people.forEach((i) => {
        const h = health[i];
        for (const q of MEDICAL_QUESTIONS) {
          if (!h.answers[q.key]) e[`m${i}.med.${q.key}`] = "Choose No, Yes or Unknown.";
        }
        for (const [k, v] of Object.entries(h.notes)) {
          if (v.length > DETAILS_MAX) e[`m${i}.note.${k}`] = `Use at most ${DETAILS_MAX} characters.`;
        }
        if (!h.medical_aid) e[`m${i}.medical_aid`] = "Choose Yes or No.";
        if (h.doctor_phone.trim() && !normaliseAnyPhone(h.doctor_phone)) e[`m${i}.doctor_phone`] = "Enter a number like 012 345 6789, or leave it blank.";
      });
    }
    if (s === 3) {
      people.forEach((i) => {
        for (const sec of CONSENT_SECTIONS) {
          if (!consents[i][sec.key]) e[`m${i}.consent.${sec.key}`] = `${names[i]} must accept this section.`;
        }
        if (!photo[i]) e[`m${i}.photo`] = "Choose Yes or No.";
      });
      if (!isPartner) {
        const pw = passwordProblem(password);
        if (pw) e.password = pw;
        else if (confirm !== password) e.confirm = "The two passwords don't match.";
      }
    }
    if (s === 4) {
      people.forEach((i) => {
        if (!declared[i]) e[`m${i}.declaration`] = `${names[i]} must accept the declaration.`;
        if (!cleanPersonName(legalName[i])) e[`m${i}.legal_name`] = "Type your full legal name.";
        if (!signatures[i]) e[`m${i}.signature`] = `${names[i]} still needs to sign.`;
      });
    }
    return e;
  }

  function showErrors(e: Errors) {
    setErrors(e);
    const n = Object.keys(e).length;
    setSummary(n === 1 ? "Please fix the item marked in the form." : `Please fix the ${n} items marked in the form.`);
    const first = Object.keys(e)[0];
    requestAnimationFrame(() => {
      const el = document.getElementById(fid(first));
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.focus({ preventScroll: true });
      }
    });
  }

  function goTo(s: Step) {
    setErrors({});
    setSummary(null);
    setStep(s);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      stepHeadingRef.current?.focus();
    });
  }

  function next() {
    const e = validate(step);
    if (Object.keys(e).length) return showErrors(e);
    if (step < 4) goTo((step + 1) as Step);
  }

  /** Everything one athlete filled in and signed. */
  function signedPart(i: Idx) {
    const a = athletes[i];
    const h = health[i];
    return {
      preferred_name: a.preferred_name,
      date_of_birth: a.date_of_birth,
      id_number: a.id_number,
      address: a.address,
      country: a.country,
      emergency_name: a.emergency_name,
      emergency_relationship: a.emergency_relationship,
      emergency_phone: a.emergency_phone,
      emergency_phone_alt: a.emergency_phone_alt,
      emergency_aware: a.emergency_aware,
      medical: h.answers,
      notes: h.notes,
      medical_aid: h.medical_aid,
      medical_aid_provider: h.medical_aid === "yes" ? h.medical_aid_provider : "",
      medical_aid_number: h.medical_aid === "yes" ? h.medical_aid_number : "",
      doctor_name: h.doctor_name,
      doctor_phone: h.doctor_phone,
      consents: { ...consents[i], [FINAL_DECLARATION_SECTION.key]: declared[i] },
      photo_consent: photo[i],
      legal_name: legalName[i],
      signature_png: signatures[i],
    };
  }

  // ---------------- Submit ----------------
  async function submit() {
    for (const s of [1, 2, 3, 4] as Step[]) {
      const e = validate(s);
      if (Object.keys(e).length) {
        if (s !== step) {
          setStep(s);
          requestAnimationFrame(() => showErrors(e));
        } else showErrors(e);
        return;
      }
    }
    if (!division) return;

    setSubmitting(true);
    setSummary(null);
    try {
      if (partner) {
        await submitPartner(partner);
      } else {
        await submitTeam(division);
      }
    } catch {
      setSummary("We couldn't reach the server. Check your connection and try again - nothing has been lost.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitTeam(div: Division) {
    const body = {
      eventId: event.id,
      website,
      division: div,
      team_name: cleanTeamName(teamName) ?? "",
      password,
      partner_signs_later: partnerLater,
      members: ([0, 1] as const).map((i) => ({
        first_name: athletes[i].first_name,
        surname: athletes[i].surname,
        gender: genderOf(div, i),
        phone: athletes[i].phone,
        email: athletes[i].email,
        ...(people.includes(i) ? signedPart(i) : {}),
      })),
    };
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      field?: string;
      teamId?: string;
      username?: string;
      loginCreated?: boolean;
      teamName?: string;
      passToken?: string | null;
      signToken?: string | null;
      emailed?: boolean;
      status?: string;
    };
    if (res.ok && json.ok && json.teamId) {
      setResult({
        teamId: json.teamId,
        username: json.username ?? json.teamId.toLowerCase(),
        loginCreated: json.loginCreated === true,
        teamName: json.teamName ?? `Team ${json.teamId}`,
        division: div,
        athletes: names,
        passToken: typeof json.passToken === "string" ? json.passToken : null,
        signToken: typeof json.signToken === "string" ? json.signToken : null,
        emailed: json.emailed === true,
        status: json.status === "booked" ? "booked" : "confirmed",
      });
      requestAnimationFrame(() => window.scrollTo({ top: 0 }));
      return;
    }
    const msg = json.error ?? "Something went wrong saving your registration. Please try again.";
    if (json.field === "team_name") {
      lastNamesFetch.current = 0;
      loadNames(0);
      setStep(1);
      requestAnimationFrame(() => showErrors({ team_name: msg }));
      return;
    }
    if (json.field === "password") {
      setStep(3);
      requestAnimationFrame(() => showErrors({ password: msg }));
      return;
    }
    setSummary(msg);
  }

  async function submitPartner(p: PartnerInfo) {
    const res = await fetch("/api/register/sign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ t: p.token, member: signedPart(1) }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      status?: string;
      teamId?: string;
      teamName?: string;
      username?: string;
      athletes?: string[];
      passToken?: string | null;
      emailed?: boolean;
    };
    if (res.ok && json.ok && json.teamId) {
      const list = json.athletes ?? [];
      setResult({
        teamId: json.teamId,
        username: json.username ?? json.teamId.toLowerCase(),
        loginCreated: true,
        teamName: json.teamName ?? p.teamName,
        division: p.division,
        athletes: [list[0] ?? p.bookerName, list[1] ?? names[1]],
        passToken: typeof json.passToken === "string" ? json.passToken : null,
        signToken: null,
        emailed: json.emailed === true,
        status: "confirmed",
        partnerView: true,
        bookerFirstName: p.bookerName.trim().split(/\s+/)[0],
      });
      requestAnimationFrame(() => window.scrollTo({ top: 0 }));
      return;
    }
    setSummary(json.error ?? "Something went wrong saving your registration. Please try again.");
  }

  // ---------------- Render ----------------
  if (result) {
    return result.status === "booked" ? (
      <Booked result={result} event={event} brand={brand} />
    ) : (
      <Confirmation result={result} event={event} brand={brand} />
    );
  }

  const blankName = `Team ${event.team_id_prefix}0xx`;
  const titles: Record<Step, string> = isPartner
    ? { 1: "Your details", 2: "Medical", 3: "Consents", 4: "Declaration & signature" }
    : {
        1: "Team & athletes",
        2: "Medical",
        3: "Consents & team login",
        4: people.length === 2 ? "Declaration & signatures" : "Declaration & signature",
      };

  // One athlete's own details (section 1 and 2 of the form).
  function personalFields(i: Idx) {
    const a = athletes[i];
    const ac = (v: string) => (i === people[0] ? v : "off");
    return (
      <>
        <TextField errKey={`m${i}.preferred_name`} label="Preferred name" optional value={a.preferred_name} maxLength={NAME_MAX} autoComplete={ac("nickname")} onChange={(v) => setAthleteField(i, "preferred_name", v)} error={errors[`m${i}.preferred_name`]} />
        <TextField errKey={`m${i}.date_of_birth`} label="Date of birth" type="date" max={todayIso()} value={a.date_of_birth} autoComplete={ac("bday")} onChange={(v) => setAthleteField(i, "date_of_birth", v)} error={errors[`m${i}.date_of_birth`]} />
        <TextField errKey={`m${i}.id_number`} label="South African ID number / Passport number" value={a.id_number} maxLength={ID_MAX + 6} autoComplete="off" autoCapitalize="characters" onChange={(v) => setAthleteField(i, "id_number", v)} error={errors[`m${i}.id_number`]} />
        <TextArea errKey={`m${i}.address`} label="Residential address" rows={3} maxLength={ADDRESS_MAX} autoComplete={ac("street-address")} value={a.address} onChange={(v) => setAthleteField(i, "address", v)} error={errors[`m${i}.address`]} />
        <TextField errKey={`m${i}.country`} label="Country of residence" value={a.country} maxLength={SHORT_MAX} autoComplete={ac("country-name")} onChange={(v) => setAthleteField(i, "country", v)} error={errors[`m${i}.country`]} />
        <div className="stitch pt-4">
          <p className="mb-3 text-sm font-semibold text-fofPaper">Emergency contact</p>
          <div className="space-y-4">
            <TextField errKey={`m${i}.emergency_name`} label="Full name" autoComplete="off" value={a.emergency_name} maxLength={NAME_MAX} onChange={(v) => setAthleteField(i, "emergency_name", v)} error={errors[`m${i}.emergency_name`]} />
            <TextField errKey={`m${i}.emergency_relationship`} label="Relationship to athlete" autoComplete="off" value={a.emergency_relationship} maxLength={RELATIONSHIP_MAX} onChange={(v) => setAthleteField(i, "emergency_relationship", v)} error={errors[`m${i}.emergency_relationship`]} hint="For example Mother, Partner or Friend" />
            <TextField errKey={`m${i}.emergency_phone`} label="Mobile number" type="tel" inputMode="tel" autoComplete="off" value={a.emergency_phone} maxLength={20} onChange={(v) => setAthleteField(i, "emergency_phone", v)} error={errors[`m${i}.emergency_phone`]} />
            <TextField errKey={`m${i}.emergency_phone_alt`} label="Alternative number" optional type="tel" inputMode="tel" autoComplete="off" value={a.emergency_phone_alt} maxLength={20} onChange={(v) => setAthleteField(i, "emergency_phone_alt", v)} error={errors[`m${i}.emergency_phone_alt`]} />
            <Choice
              errKey={`m${i}.emergency_aware`}
              label="Is your emergency contact aware that you are participating in this event?"
              value={a.emergency_aware}
              options={[
                { value: "yes", label: "Yes" },
                { value: "no", label: "No" },
              ]}
              onChange={(v) => setAthleteField(i, "emergency_aware", v)}
              error={errors[`m${i}.emergency_aware`]}
            />
          </div>
        </div>
      </>
    );
  }

  function medicalQuestion(i: Idx, q: (typeof MEDICAL_QUESTIONS)[number]) {
    const key = `m${i}.med.${q.key}`;
    const val = health[i].answers[q.key];
    return (
      <li key={q.key} className="space-y-3 py-3">
        <Choice
          errKey={key}
          label={q.label}
          value={val}
          options={NO_YES_UNKNOWN}
          onChange={(v) => {
            setPair(setHealth, i, (h) => ({ ...h, answers: { ...h.answers, [q.key]: v } }));
            clearError(key);
          }}
          error={errors[key]}
        />
        {q.detail && (val === "yes" || val === "unknown") && (
          <TextArea
            errKey={`m${i}.note.${q.detail.key}`}
            label={q.detail.label}
            hint={q.detail.hint}
            optional
            value={health[i].notes[q.detail.key] ?? ""}
            onChange={(v) => setNote(i, q.detail!.key, v)}
            error={errors[`m${i}.note.${q.detail.key}`]}
          />
        )}
      </li>
    );
  }

  return (
    <div>
      <EventHeader event={event} brand={brand} compact />

      {isPartner && partner && step === 1 && (
        <div className="mt-6 rounded-lg border border-fofRed bg-fofPanel p-4">
          <p className="text-[15px] text-fofPaper">
            <b>{partner.bookerName}</b> signed up <b>{partner.teamName}</b> (<span className="nums">{partner.teamId}</span>) with
            you as their partner. Your spot is booked - fill in your own details and sign to <span className="text-fofRed">confirm</span> it.
          </p>
        </div>
      )}

      {/* Progress */}
      <div className="mt-6">
        <p className="nums text-xs uppercase tracking-widest text-fofGunmetal">Step {step} of 4</p>
        <h2 ref={stepHeadingRef} tabIndex={-1} className="font-display text-3xl tracking-wide text-fofPaper outline-none">
          {titles[step]}
        </h2>
        <div className="mt-3 grid grid-cols-4 gap-1.5" aria-hidden="true">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className={`h-1.5 rounded-full ${n <= step ? "bg-fofRed" : "bg-fofCharcoal"}`} />
          ))}
        </div>
      </div>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 4) next();
          else submit();
        }}
        className="mt-6"
      >
        {/* Honeypot: hidden from people and screen readers. */}
        <div aria-hidden="true" className="absolute -left-[9999px] top-0 h-px w-px overflow-hidden">
          <label htmlFor="website">Leave this empty</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>

        {/* ---------------- Step 1 ---------------- */}
        {step === 1 && (
          <div className="space-y-8">
            <div>
              <LegalText section={IMPORTANT_INFO} />
              <p className="mt-2 text-xs text-fofGunmetal">Organiser: {ORGANISER}</p>
            </div>

            {!isPartner && (
              <>
                <fieldset>
                  <legend className="mb-2 text-sm text-fofPaper">Team type (category)</legend>
                  <div
                    id={fid("division")}
                    tabIndex={-1}
                    role="radiogroup"
                    aria-label="Team type"
                    aria-describedby={errors.division ? `${fid("division")}-err` : undefined}
                    className="grid grid-cols-3 gap-2 outline-none"
                  >
                    {(["Men", "Mixed", "Women"] as Division[]).map((d) => {
                      const t = TEAM_TYPES.find((x) => x.division === d)!;
                      const on = division === d;
                      return (
                        <button
                          key={d}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => {
                            setDivision(d);
                            clearError("division");
                          }}
                          className={`flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-lg border-2 px-1 py-3 ${
                            on ? "border-fofRed bg-fofCharcoal text-fofPaper" : "border-fofRule bg-fofPanel text-fofGunmetal"
                          }`}
                        >
                          <span className={`flex gap-1 ${on ? "text-fofRed" : ""}`}>
                            <PersonIcon gender={t.genders[0]} />
                            <PersonIcon gender={t.genders[1]} />
                          </span>
                          <span className="text-sm font-semibold leading-tight text-fofPaper">{t.label.replace(" / ", "/")}</span>
                          <span className="text-xs">{d}</span>
                        </button>
                      );
                    })}
                  </div>
                  <FieldError id={fid("division")} msg={errors.division} />
                </fieldset>

                <div>
                  <TextField
                    errKey="team_name"
                    label="Team name"
                    optional
                    value={teamName}
                    maxLength={TEAM_NAME_MAX + 10}
                    onChange={(v) => {
                      setTeamName(v);
                      clearError("team_name");
                    }}
                    error={errors.team_name}
                    hint={`Leave it blank and you'll be “${blankName}”, using your Team ID. Your Team ID (team number) is given automatically.`}
                    autoComplete="off"
                  />
                  <p aria-live="polite" className="mt-1 min-h-[1.25rem] text-sm">
                    {!errors.team_name && nameStatus === "taken" && (
                      <span className="text-fofRed">“{teamName.trim()}” is already taken. Try another name.</span>
                    )}
                    {!errors.team_name && nameStatus === "available" && <span className="text-fofPaper">✓ Available</span>}
                    {!errors.team_name && nameStatus === "checking" && <span className="text-fofGunmetal">Checking…</span>}
                    {!errors.team_name && nameStatus === "reserved" && (
                      <span className="text-fofRed">Names like “Team {event.team_id_prefix}001” are kept for teams without a name.</span>
                    )}
                    {!errors.team_name && nameStatus === "invalid" && (
                      <span className="text-fofRed">Use at most {TEAM_NAME_MAX} characters, without &lt; or &gt;.</span>
                    )}
                  </p>
                  {takenNames.length > 0 && (
                    <p className="mt-1 text-sm text-fofGunmetal">
                      Names already taken: {(showAllNames ? takenNames : takenNames.slice(0, 3)).join(" · ")}
                      {takenNames.length > 3 && (
                        <>
                          {" · "}
                          <button
                            type="button"
                            onClick={() => setShowAllNames((v) => !v)}
                            aria-expanded={showAllNames}
                            className="inline-flex min-h-[44px] items-center text-fofRed underline underline-offset-2"
                          >
                            {showAllNames ? "show fewer" : `see all ${takenNames.length}`}
                          </button>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </>
            )}

            {(isPartner ? ([1] as Idx[]) : ([0, 1] as Idx[])).map((i) => {
              const g = genderOf(division, i);
              const a = athletes[i];
              const full = people.includes(i);
              const ac = (v: string) => (i === people[0] ? v : "off");
              return (
                <fieldset key={i} className="space-y-4 rounded-lg border border-fofRule bg-fofPanel p-4">
                  <legend className="px-1 font-display text-lg tracking-widest text-fofRed">
                    {isPartner ? "YOU" : `ATHLETE ${i + 1}`}
                    {g ? ` · ${g.toUpperCase()}` : ""}
                  </legend>

                  {!isPartner && i === 1 && (
                    <div role="radiogroup" aria-label="How will athlete 2 sign?" className="space-y-2">
                      <p className="text-sm text-fofPaper">How will {a.first_name.trim() || "athlete 2"} sign?</p>
                      {[
                        { later: true, title: "Email them a link to sign", sub: "On their own phone. Your spot is booked now and confirmed when they sign." },
                        { later: false, title: "They're with me - sign here now", sub: "Fill in both athletes' details on this phone." },
                      ].map((o) => {
                        const on = partnerLater === o.later;
                        return (
                          <button
                            key={String(o.later)}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setPartnerLater(o.later)}
                            className={`w-full rounded-md border-2 px-4 py-3 text-left ${on ? "border-fofRed bg-fofCharcoal" : "border-fofRule"}`}
                          >
                            <span className="block font-semibold text-fofPaper">
                              {on ? "● " : "○ "}
                              {o.title}
                            </span>
                            <span className="block text-sm text-fofGunmetal">{o.sub}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField errKey={`m${i}.first_name`} label="First name" value={a.first_name} maxLength={NAME_MAX} readOnly={isPartner} autoComplete={ac("given-name")} onChange={(v) => setAthleteField(i, "first_name", v)} error={errors[`m${i}.first_name`]} />
                    <TextField errKey={`m${i}.surname`} label="Surname" value={a.surname} maxLength={NAME_MAX} readOnly={isPartner} autoComplete={ac("family-name")} onChange={(v) => setAthleteField(i, "surname", v)} error={errors[`m${i}.surname`]} />
                  </div>
                  <TextField errKey={`m${i}.phone`} label="Mobile phone number" type="tel" inputMode="tel" readOnly={isPartner} autoComplete={ac("tel")} value={a.phone} maxLength={20} onChange={(v) => setAthleteField(i, "phone", v)} error={errors[`m${i}.phone`]} hint={isPartner ? undefined : "Like 082 123 4567 or +27 82 123 4567"} />
                  <TextField errKey={`m${i}.email`} label="Email address" type="email" inputMode="email" readOnly={isPartner} autoCapitalize="none" autoComplete={ac("email")} value={a.email} maxLength={EMAIL_MAX} onChange={(v) => setAthleteField(i, "email", v)} error={errors[`m${i}.email`]} hint={!isPartner && i === 1 && partnerLater ? "We'll send the link to sign to this address." : undefined} />
                  {isPartner && (
                    <p className="text-xs text-fofGunmetal">Name, phone or email wrong? Ask the organisers to fix it after you&apos;ve signed.</p>
                  )}

                  {full ? (
                    personalFields(i)
                  ) : (
                    <p className="rounded-md border border-dashed border-fofRule px-4 py-3 text-sm text-fofGunmetal">
                      {a.first_name.trim() || "Athlete 2"} fills in their own date of birth, ID, address, emergency contact, medical
                      questions and signature from the link we email them.
                    </p>
                  )}
                </fieldset>
              );
            })}
          </div>
        )}

        {/* ---------------- Step 2 ---------------- */}
        {step === 2 && (
          <div className="space-y-6">
            <LegalText section={MEDICAL_INTRO} />

            {people.map((i) => {
              const h = health[i];
              return (
                <fieldset key={i} className="space-y-4 rounded-lg border border-fofRule bg-fofPanel p-4">
                  <legend className="px-1 font-display text-lg tracking-widest text-fofRed">{names[i].toUpperCase()}</legend>

                  <ul className="divide-y divide-fofRule">{MEDICAL_QUESTIONS.filter((q) => q.group === "medical").map((q) => medicalQuestion(i, q))}</ul>
                  <TextArea
                    errKey={`m${i}.note.${MEDICAL_ADDITIONAL.key}`}
                    label={MEDICAL_ADDITIONAL.label}
                    optional
                    value={h.notes[MEDICAL_ADDITIONAL.key] ?? ""}
                    onChange={(v) => setNote(i, MEDICAL_ADDITIONAL.key, v)}
                    error={errors[`m${i}.note.${MEDICAL_ADDITIONAL.key}`]}
                  />

                  <div className="stitch pt-4">
                    <p className="font-display text-lg tracking-wide text-fofPaper">{INJURIES_TITLE}</p>
                    <ul className="divide-y divide-fofRule">{MEDICAL_QUESTIONS.filter((q) => q.group === "injuries").map((q) => medicalQuestion(i, q))}</ul>
                    <TextArea
                      errKey={`m${i}.note.${INJURIES_ANYTHING_ELSE.key}`}
                      label={INJURIES_ANYTHING_ELSE.label}
                      optional
                      value={h.notes[INJURIES_ANYTHING_ELSE.key] ?? ""}
                      onChange={(v) => setNote(i, INJURIES_ANYTHING_ELSE.key, v)}
                      error={errors[`m${i}.note.${INJURIES_ANYTHING_ELSE.key}`]}
                    />
                  </div>

                  <div className="stitch space-y-4 pt-4">
                    <p className="font-display text-lg tracking-wide text-fofPaper">{MEDICAL_AID.title}</p>
                    <Choice
                      errKey={`m${i}.medical_aid`}
                      label="Do you have medical aid or medical insurance?"
                      value={h.medical_aid}
                      options={[
                        { value: "yes", label: "Yes" },
                        { value: "no", label: "No" },
                      ]}
                      onChange={(v) => setHealthField(i, "medical_aid", v)}
                      error={errors[`m${i}.medical_aid`]}
                    />
                    {h.medical_aid === "yes" && (
                      <>
                        <TextField errKey={`m${i}.medical_aid_provider`} label="Medical aid / insurance provider" optional value={h.medical_aid_provider} maxLength={SHORT_MAX} autoComplete="off" onChange={(v) => setHealthField(i, "medical_aid_provider", v)} error={errors[`m${i}.medical_aid_provider`]} />
                        <TextField errKey={`m${i}.medical_aid_number`} label="Medical aid / membership number" optional value={h.medical_aid_number} maxLength={SHORT_MAX} autoComplete="off" onChange={(v) => setHealthField(i, "medical_aid_number", v)} error={errors[`m${i}.medical_aid_number`]} />
                      </>
                    )}
                    <TextField errKey={`m${i}.doctor_name`} label="Name of treating doctor / medical practitioner" optional value={h.doctor_name} maxLength={SHORT_MAX} autoComplete="off" onChange={(v) => setHealthField(i, "doctor_name", v)} error={errors[`m${i}.doctor_name`]} />
                    <TextField errKey={`m${i}.doctor_phone`} label="Doctor / medical practitioner contact number" optional type="tel" inputMode="tel" value={h.doctor_phone} maxLength={20} autoComplete="off" onChange={(v) => setHealthField(i, "doctor_phone", v)} error={errors[`m${i}.doctor_phone`]} />
                    <p className="text-sm text-fofGunmetal">{MEDICAL_AID.paragraphs[0]}</p>
                  </div>
                </fieldset>
              );
            })}
          </div>
        )}

        {/* ---------------- Step 3 ---------------- */}
        {step === 3 && (
          <div className="space-y-8">
            {CONSENT_SECTIONS.map((sec, n) => (
              <section key={sec.key} className="space-y-3">
                <LegalText section={sec} number={n + 1} />
                {people.map((i) => {
                  const key = `m${i}.consent.${sec.key}`;
                  return (
                    <div key={i}>
                      <Tick
                        id={fid(key)}
                        checked={!!consents[i][sec.key]}
                        error={!!errors[key]}
                        onChange={(v) => {
                          setPair(setConsents, i, (c) => ({ ...c, [sec.key]: v }));
                          clearError(key);
                        }}
                      >
                        <strong>{names[i]}</strong> agrees to all of the above
                      </Tick>
                      <FieldError id={fid(key)} msg={errors[key]} />
                    </div>
                  );
                })}
              </section>
            ))}

            <section className="space-y-3 rounded-lg border border-fofRule bg-fofPanel p-4">
              <h3 className="font-display text-xl tracking-wide text-fofPaper">{PHOTO_CONSENT.title}</h3>
              <p className="text-sm text-fofGunmetal">Your choice here doesn&apos;t affect your entry.</p>
              {people.map((i) => {
                const key = `m${i}.photo`;
                return (
                  <div key={i} id={fid(key)} tabIndex={-1} role="radiogroup" aria-label={`Photography and video - ${names[i]}`} className="space-y-2 outline-none">
                    {people.length > 1 && <p className="text-sm font-semibold text-fofPaper">{names[i]}</p>}
                    {(["yes", "no"] as const).map((v) => {
                      const on = photo[i] === v;
                      return (
                        <button
                          key={v}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => {
                            setPair<"" | "yes" | "no">(setPhoto, i, v);
                            clearError(key);
                          }}
                          className={`w-full rounded-md border-2 px-4 py-3 text-left text-[15px] leading-snug text-fofPaper ${
                            on ? "border-fofRed bg-fofCharcoal" : errors[key] ? "border-fofRed" : "border-fofRule"
                          }`}
                        >
                          {on ? "● " : "○ "}
                          {v === "yes" ? PHOTO_CONSENT.yes : PHOTO_CONSENT.no}
                        </button>
                      );
                    })}
                    <FieldError id={fid(key)} msg={errors[key]} />
                  </div>
                );
              })}
            </section>

            {!isPartner && (
              <section className="space-y-4 rounded-lg border border-fofRule bg-fofPanel p-4">
                <h3 className="font-display text-xl tracking-wide text-fofPaper">Team login (to follow your race live)</h3>
                <p className="text-[15px] text-fofGunmetal">
                  Choose a password for your team. Your username will be your Team ID (like {event.team_id_prefix.toLowerCase()}024), shown after you register.
                </p>
                <div>
                  <label htmlFor={fid("password")} className="mb-1 block text-sm text-fofPaper">
                    Password
                  </label>
                  <PasswordInput
                    id={fid("password")}
                    value={password}
                    minLength={8}
                    onChange={(v) => {
                      setPassword(v.slice(0, PASSWORD_MAX));
                      clearError("password");
                    }}
                  />
                  <p className="mt-1 text-xs text-fofGunmetal">At least 8 characters.</p>
                  <FieldError id={fid("password")} msg={errors.password} />
                </div>
                <div>
                  <label htmlFor={fid("confirm")} className="mb-1 block text-sm text-fofPaper">
                    Type the password again
                  </label>
                  <PasswordInput
                    id={fid("confirm")}
                    value={confirm}
                    onChange={(v) => {
                      setConfirm(v.slice(0, PASSWORD_MAX));
                      clearError("confirm");
                    }}
                  />
                  <FieldError id={fid("confirm")} msg={errors.confirm} />
                </div>
              </section>
            )}
          </div>
        )}

        {/* ---------------- Step 4 ---------------- */}
        {step === 4 && (
          <div className="space-y-8">
            <section className="space-y-3">
              <LegalText section={FINAL_DECLARATION_SECTION} />
              {people.map((i) => {
                const key = `m${i}.declaration`;
                return (
                  <div key={i}>
                    <Tick
                      id={fid(key)}
                      checked={declared[i]}
                      error={!!errors[key]}
                      onChange={(v) => {
                        setPair(setDeclared, i, v);
                        clearError(key);
                      }}
                    >
                      <strong>{names[i]}</strong> agrees to all of the above
                    </Tick>
                    <FieldError id={fid(key)} msg={errors[key]} />
                  </div>
                );
              })}
            </section>

            <section className="space-y-6">
              <h3 className="font-display text-xl tracking-wide text-fofPaper">Electronic signature</h3>
              {people.map((i) => {
                const key = `m${i}.signature`;
                return (
                  <div key={i} className="space-y-3">
                    <p className="font-display text-lg tracking-widest text-fofRed">{names[i].toUpperCase()}</p>
                    <TextField
                      errKey={`m${i}.legal_name`}
                      label="Full legal name"
                      value={legalName[i]}
                      maxLength={NAME_MAX}
                      autoComplete={i === people[0] ? "name" : "off"}
                      onChange={(v) => {
                        setPair(setLegalName, i, v);
                        clearError(`m${i}.legal_name`);
                      }}
                      error={errors[`m${i}.legal_name`]}
                    />
                    <div id={fid(key)} tabIndex={-1} className="outline-none">
                      <SignaturePad
                        label={`Signature for ${names[i]}`}
                        hasSignature={!!signatures[i]}
                        describedBy={`${fid(key)}-when`}
                        onChange={(png) => {
                          setPair(setSignatures, i, png);
                          setPair(setSignedAt, i, png ? new Date() : null);
                          if (png) clearError(key);
                        }}
                      />
                      <p id={`${fid(key)}-when`} className="nums mt-1 text-sm text-fofGunmetal">
                        {signedAt[i] ? `Signed on ${SA_TIME.format(signedAt[i]!)}` : "Not signed yet"}
                      </p>
                      <FieldError id={fid(key)} msg={errors[key]} />
                    </div>
                  </div>
                );
              })}
              {!isPartner && partnerLater && (
                <p className="rounded-md border border-dashed border-fofRule px-4 py-3 text-sm text-fofGunmetal">
                  After you register, we&apos;ll email {partnerFirst} a link to sign. Your spot is booked now and confirmed when{" "}
                  {partnerFirst} signs.
                </p>
              )}
            </section>
          </div>
        )}

        {/* ---------------- Errors + navigation ---------------- */}
        <div aria-live="assertive" role="alert" className="mt-6 min-h-[1.5rem]">
          {summary && <p className="rounded-md border border-fofRed px-4 py-3 text-sm text-fofPaper">{summary}</p>}
        </div>

        <div className="mt-4 flex gap-3">
          {step > 1 && (
            <button
              type="button"
              onClick={() => goTo((step - 1) as Step)}
              disabled={submitting}
              className="tap-target w-1/3 rounded-md border border-fofGunmetal font-display text-lg tracking-wide text-fofPaper disabled:opacity-60"
            >
              Back
            </button>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="tap-target flex-1 rounded-md btn-stamped font-display text-lg tracking-wide disabled:opacity-60"
          >
            {step < 4
              ? "Next"
              : submitting
                ? isPartner
                  ? "Saving…"
                  : "Registering…"
                : isPartner
                  ? "Sign and confirm our spot"
                  : partnerLater
                    ? "Book our spot"
                    : "Register team"}
          </button>
        </div>
      </form>
    </div>
  );
}
