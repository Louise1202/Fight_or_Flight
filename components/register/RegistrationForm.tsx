"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PasswordInput from "@/components/PasswordInput";
import { TEAM_TYPES, formatEventDate, type Brand, type Division } from "@/lib/events";
import {
  CONSENT_SECTIONS,
  FINAL_DECLARATION,
  MEDICAL_INTRO,
  MEDICAL_QUESTIONS,
  type LegalSection,
  type MedicalAnswer,
} from "@/lib/legal/survivor";
import {
  DETAILS_MAX,
  EMAIL_MAX,
  NAME_MAX,
  PASSWORD_MAX,
  RELATIONSHIP_MAX,
  TEAM_NAME_MAX,
  cleanEmail,
  cleanPersonName,
  cleanRelationship,
  cleanTeamName,
  isReservedTeamName,
  normalisePhone,
  passwordProblem,
  teamNameKey,
} from "@/components/register/rules";
import EventHeader, { type PublicEvent } from "@/components/register/EventHeader";
import SignaturePad from "@/components/register/SignaturePad";

// ---------------------------------------------------------------------
// Types and helpers
// ---------------------------------------------------------------------

type Step = 1 | 2 | 3 | 4;

const STEP_TITLES: Record<Step, string> = {
  1: "Team & athletes",
  2: "Medical",
  3: "Consents & team login",
  4: "Declaration & signatures",
};

type Athlete = {
  first_name: string;
  surname: string;
  phone: string;
  email: string;
  emergency_name: string;
  emergency_phone: string;
  emergency_relationship: string;
};

const EMPTY_ATHLETE: Athlete = {
  first_name: "",
  surname: "",
  phone: "",
  email: "",
  emergency_name: "",
  emergency_phone: "",
  emergency_relationship: "",
};

type Pair<T> = [T, T];
type Errors = Record<string, string>;
type NameStatus = "idle" | "checking" | "taken" | "available" | "reserved" | "invalid";

type Result = {
  teamId: string;
  username: string;
  loginCreated: boolean;
  teamName: string;
  division: Division;
  athletes: Pair<string>;
  /** Signed token for the Island Pass picture (null if the server didn't send one). */
  passToken: string | null;
  /** Whether the "You're registered" email went out. */
  emailed: boolean;
};

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

function genderOf(division: Division | null, i: 0 | 1): "male" | "female" | null {
  const t = TEAM_TYPES.find((x) => x.division === division);
  return t ? t.genders[i] : null;
}

function fullName(a: Athlete, i: number) {
  const n = `${a.first_name.trim()} ${a.surname.trim()}`.trim();
  return n || `Athlete ${i + 1}`;
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`tap-target w-full rounded-md border bg-transparent px-4 text-lg text-fofPaper ${
          error ? "border-fofRed" : "border-fofGunmetal"
        }`}
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

function LegalText({ section }: { section: LegalSection }) {
  const [open, setOpen] = useState(false);
  const allParas = section.paragraphs;
  const shownParas = open ? allParas : allParas.slice(0, 2);
  const hasMore = allParas.length > 2 || (section.bullets?.length ?? 0) > 0 || (section.closing?.length ?? 0) > 0;
  const bodyId = `legal-${section.key}`;
  return (
    <div className="rounded-lg border border-fofRule bg-fofPanel p-4">
      <h3 className="font-display text-xl tracking-wide text-fofPaper">{section.title}</h3>
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
    </div>
  );
}

// ---------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------

export default function RegistrationForm({ event, brand }: { event: PublicEvent; brand: Brand }) {
  const [step, setStep] = useState<Step>(1);
  const [errors, setErrors] = useState<Errors>({});
  const [summary, setSummary] = useState<string | null>(null);

  // Step 1
  const [division, setDivision] = useState<Division | null>(null);
  const [teamName, setTeamName] = useState("");
  const [athletes, setAthletes] = useState<Pair<Athlete>>([{ ...EMPTY_ATHLETE }, { ...EMPTY_ATHLETE }]);
  const [website, setWebsite] = useState(""); // honeypot

  // Step 2
  const [medical, setMedical] = useState<Pair<Record<string, MedicalAnswer | undefined>>>([{}, {}]);
  const [details, setDetails] = useState<Pair<string>>(["", ""]);

  // Step 3
  const [consents, setConsents] = useState<Pair<Record<string, boolean>>>([{}, {}]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Step 4
  const [declared, setDeclared] = useState<Pair<Record<string, boolean>>>([{}, {}]);
  const [signatures, setSignatures] = useState<Pair<string | null>>([null, null]);
  const [signedAt, setSignedAt] = useState<Pair<Date | null>>([null, null]);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const stepHeadingRef = useRef<HTMLHeadingElement>(null);

  // ---------------- Team names already taken ----------------
  const [takenNames, setTakenNames] = useState<string[]>([]);
  const [showAllNames, setShowAllNames] = useState(false);
  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");
  const lastNamesFetch = useRef(0);
  const nameReq = useRef(0);

  const loadNames = useCallback(
    async (maxAgeMs: number): Promise<string[] | null> => {
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
    [event.id]
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
  const dirty = !result && (division !== null || athletes[0].first_name !== "" || teamName !== "");
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
  function setPair<T>(setter: React.Dispatch<React.SetStateAction<Pair<T>>>, i: 0 | 1, value: T | ((prev: T) => T)) {
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

  function setAthleteField(i: 0 | 1, field: keyof Athlete, v: string) {
    setPair(setAthletes, i, (a) => ({ ...a, [field]: v }));
    clearError(`m${i}.${field}`);
  }

  const names: Pair<string> = [fullName(athletes[0], 0), fullName(athletes[1], 1)];

  // ---------------- Validation per step ----------------
  function validate(s: Step): Errors {
    const e: Errors = {};
    if (s === 1) {
      if (!division) e.division = "Choose your team type.";
      const tn = cleanTeamName(teamName);
      if (tn === null) e.team_name = `Use at most ${TEAM_NAME_MAX} characters, without < or >.`;
      else if (tn && isReservedTeamName(tn)) e.team_name = `Names like “Team ${event.team_id_prefix}001” are kept for teams without a name. Try another name.`;
      else if (tn && takenNames.some((n) => teamNameKey(n) === teamNameKey(tn)))
        e.team_name = `“${tn}” is already taken. Try another name.`;
      ([0, 1] as const).forEach((i) => {
        const a = athletes[i];
        if (!a.first_name.trim()) e[`m${i}.first_name`] = "Enter a first name.";
        else if (!cleanPersonName(a.first_name)) e[`m${i}.first_name`] = "Use letters, spaces, apostrophes or hyphens only.";
        if (!a.surname.trim()) e[`m${i}.surname`] = "Enter a surname.";
        else if (!cleanPersonName(a.surname)) e[`m${i}.surname`] = "Use letters, spaces, apostrophes or hyphens only.";
        if (!normalisePhone(a.phone)) e[`m${i}.phone`] = "Enter a 10-digit number, like 082 123 4567 or +27 82 123 4567.";
        if (!cleanEmail(a.email)) e[`m${i}.email`] = "Enter a valid email address.";
        if (!a.emergency_name.trim()) e[`m${i}.emergency_name`] = "Enter the name of someone we can call in an emergency.";
        else if (!cleanPersonName(a.emergency_name)) e[`m${i}.emergency_name`] = "Use letters, spaces, apostrophes or hyphens only.";
        if (!normalisePhone(a.emergency_phone)) e[`m${i}.emergency_phone`] = "Enter a 10-digit number, like 082 123 4567.";
        else if (normalisePhone(a.emergency_phone) === normalisePhone(a.phone))
          e[`m${i}.emergency_phone`] = "Use someone else's number - not the athlete's own.";
        if (cleanRelationship(a.emergency_relationship) === null)
          e[`m${i}.emergency_relationship`] = "Use letters only, like Mother or Partner.";
      });
    }
    if (s === 2) {
      ([0, 1] as const).forEach((i) => {
        for (const q of MEDICAL_QUESTIONS) {
          if (!medical[i][q.key]) e[`m${i}.med.${q.key}`] = "Choose No, Yes or Unknown.";
        }
        const anyYes = MEDICAL_QUESTIONS.some((q) => medical[i][q.key] === "yes");
        if (anyYes && !details[i].trim()) e[`m${i}.details`] = "Please give a few details about the Yes answers.";
        if (details[i].length > DETAILS_MAX) e[`m${i}.details`] = `Use at most ${DETAILS_MAX} characters.`;
      });
    }
    if (s === 3) {
      ([0, 1] as const).forEach((i) => {
        for (const sec of CONSENT_SECTIONS) {
          if (!consents[i][sec.key]) e[`m${i}.consent.${sec.key}`] = `${names[i]} must accept this section.`;
        }
      });
      const pw = passwordProblem(password);
      if (pw) e.password = pw;
      else if (confirm !== password) e.confirm = "The two passwords don't match.";
    }
    if (s === 4) {
      ([0, 1] as const).forEach((i) => {
        for (const d of FINAL_DECLARATION) {
          if (!declared[i][d.key]) e[`m${i}.decl.${d.key}`] = `${names[i]} must tick this statement.`;
        }
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

  // ---------------- Submit ----------------
  async function submit() {
    // Check every step again (nothing was lost, but be sure).
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
    const body = {
      eventId: event.id,
      website,
      division,
      team_name: cleanTeamName(teamName) ?? "",
      password,
      members: ([0, 1] as const).map((i) => ({
        first_name: athletes[i].first_name,
        surname: athletes[i].surname,
        gender: genderOf(division, i),
        phone: athletes[i].phone,
        email: athletes[i].email,
        emergency_name: athletes[i].emergency_name,
        emergency_phone: athletes[i].emergency_phone,
        emergency_relationship: athletes[i].emergency_relationship,
        medical: medical[i],
        medical_details: details[i],
        consents: { ...consents[i], ...declared[i] },
        signature_png: signatures[i],
      })),
    };

    try {
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
        passToken?: string;
        emailed?: boolean;
      };
      if (res.ok && json.ok && json.teamId) {
        setResult({
          teamId: json.teamId,
          username: json.username ?? json.teamId.toLowerCase(),
          loginCreated: json.loginCreated === true,
          teamName: json.teamName ?? `Team ${json.teamId}`,
          division,
          athletes: names,
          passToken: typeof json.passToken === "string" ? json.passToken : null,
          emailed: json.emailed === true,
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
    } catch {
      setSummary("We couldn't reach the server. Check your connection and try again - nothing has been lost.");
    } finally {
      setSubmitting(false);
    }
  }

  // ---------------- Render ----------------
  if (result) return <Confirmation result={result} event={event} brand={brand} />;

  const blankName = `Team ${event.team_id_prefix}0xx`;

  return (
    <div>
      <EventHeader event={event} brand={brand} compact />

      {/* Progress */}
      <div className="mt-6">
        <p className="nums text-xs uppercase tracking-widest text-fofGunmetal">Step {step} of 4</p>
        <h2 ref={stepHeadingRef} tabIndex={-1} className="font-display text-3xl tracking-wide text-fofPaper outline-none">
          {STEP_TITLES[step]}
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
            <fieldset>
              <legend className="mb-2 text-sm text-fofPaper">Team type</legend>
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
                hint={`Leave it blank and you'll be “${blankName}”, using your Team ID.`}
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
                  Names already taken:{" "}
                  {(showAllNames ? takenNames : takenNames.slice(0, 3)).join(" · ")}
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

            {([0, 1] as const).map((i) => {
              const g = genderOf(division, i);
              const a = athletes[i];
              const ac = (v: string) => (i === 0 ? v : "off");
              return (
                <fieldset key={i} className="space-y-4 rounded-lg border border-fofRule bg-fofPanel p-4">
                  <legend className="px-1 font-display text-lg tracking-widest text-fofRed">
                    ATHLETE {i + 1}
                    {g ? ` · ${g.toUpperCase()}` : ""}
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField errKey={`m${i}.first_name`} label="First name" value={a.first_name} maxLength={NAME_MAX} autoComplete={ac("given-name")} onChange={(v) => setAthleteField(i, "first_name", v)} error={errors[`m${i}.first_name`]} />
                    <TextField errKey={`m${i}.surname`} label="Surname" value={a.surname} maxLength={NAME_MAX} autoComplete={ac("family-name")} onChange={(v) => setAthleteField(i, "surname", v)} error={errors[`m${i}.surname`]} />
                  </div>
                  <TextField errKey={`m${i}.phone`} label="Cellphone" type="tel" inputMode="tel" autoComplete={ac("tel")} value={a.phone} maxLength={20} onChange={(v) => setAthleteField(i, "phone", v)} error={errors[`m${i}.phone`]} hint="Like 082 123 4567 or +27 82 123 4567" />
                  <TextField errKey={`m${i}.email`} label="Email" type="email" inputMode="email" autoCapitalize="none" autoComplete={ac("email")} value={a.email} maxLength={EMAIL_MAX} onChange={(v) => setAthleteField(i, "email", v)} error={errors[`m${i}.email`]} />
                  <div className="stitch pt-4">
                    <p className="mb-3 text-sm font-semibold text-fofPaper">Emergency contact</p>
                    <div className="space-y-4">
                      <TextField errKey={`m${i}.emergency_name`} label="Name" autoComplete="off" value={a.emergency_name} maxLength={NAME_MAX} onChange={(v) => setAthleteField(i, "emergency_name", v)} error={errors[`m${i}.emergency_name`]} />
                      <TextField errKey={`m${i}.emergency_phone`} label="Phone" type="tel" inputMode="tel" autoComplete="off" value={a.emergency_phone} maxLength={20} onChange={(v) => setAthleteField(i, "emergency_phone", v)} error={errors[`m${i}.emergency_phone`]} />
                      <TextField errKey={`m${i}.emergency_relationship`} label="Relationship" optional autoComplete="off" value={a.emergency_relationship} maxLength={RELATIONSHIP_MAX} onChange={(v) => setAthleteField(i, "emergency_relationship", v)} error={errors[`m${i}.emergency_relationship`]} hint="For example Mother, Partner or Friend" />
                    </div>
                  </div>
                </fieldset>
              );
            })}
          </div>
        )}

        {/* ---------------- Step 2 ---------------- */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="rounded-lg border border-fofRule bg-fofPanel p-4">
              <h3 className="font-display text-xl tracking-wide text-fofPaper">{MEDICAL_INTRO.title}</h3>
              <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-fofPaper">
                {MEDICAL_INTRO.paragraphs.map((p, k) => (
                  <p key={k}>{p}</p>
                ))}
              </div>
            </div>

            {([0, 1] as const).map((i) => {
              const anyYes = MEDICAL_QUESTIONS.some((q) => medical[i][q.key] === "yes");
              const dKey = `m${i}.details`;
              return (
                <fieldset key={i} className="rounded-lg border border-fofRule bg-fofPanel p-4">
                  <legend className="px-1 font-display text-lg tracking-widest text-fofRed">{names[i].toUpperCase()}</legend>
                  <ul className="divide-y divide-fofRule">
                    {MEDICAL_QUESTIONS.map((q) => {
                      const key = `m${i}.med.${q.key}`;
                      const labelId = `${fid(key)}-label`;
                      const val = medical[i][q.key];
                      return (
                        <li key={q.key} className="py-3">
                          <p id={labelId} className={`mb-2 text-[15px] leading-snug ${errors[key] ? "text-fofRed" : "text-fofPaper"}`}>
                            {q.label}
                          </p>
                          <div
                            id={fid(key)}
                            tabIndex={-1}
                            role="radiogroup"
                            aria-labelledby={labelId}
                            aria-invalid={errors[key] ? true : undefined}
                            className={`grid grid-cols-3 overflow-hidden rounded-md border outline-none ${errors[key] ? "border-fofRed" : "border-fofGunmetal"}`}
                          >
                            {(["no", "yes", "unknown"] as MedicalAnswer[]).map((ans, k) => {
                              const on = val === ans;
                              return (
                                <button
                                  key={ans}
                                  type="button"
                                  role="radio"
                                  aria-checked={on}
                                  onClick={() => {
                                    setPair(setMedical, i, (m) => ({ ...m, [q.key]: ans }));
                                    clearError(key);
                                  }}
                                  className={`tap-target text-base font-semibold capitalize ${k > 0 ? "border-l border-fofGunmetal" : ""} ${
                                    on ? "bg-fofRed text-white" : "bg-transparent text-fofPaper"
                                  }`}
                                >
                                  {ans === "unknown" ? "Unknown" : ans === "yes" ? "Yes" : "No"}
                                </button>
                              );
                            })}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-3">
                    <label htmlFor={fid(dKey)} className="mb-1 block text-sm text-fofPaper">
                      Details{anyYes ? "" : <span className="text-fofGunmetal"> (optional)</span>}
                    </label>
                    <p id={`${fid(dKey)}-hint`} className="mb-1 text-xs text-fofGunmetal">
                      {anyYes
                        ? "Tell us about each Yes answer: the condition, medication or allergy, and what to do in an emergency."
                        : "Anything else the medical team should know."}
                    </p>
                    <textarea
                      id={fid(dKey)}
                      rows={3}
                      maxLength={DETAILS_MAX}
                      value={details[i]}
                      onChange={(e) => {
                        setPair(setDetails, i, e.target.value);
                        clearError(dKey);
                      }}
                      aria-invalid={errors[dKey] ? true : undefined}
                      aria-describedby={`${fid(dKey)}-hint${errors[dKey] ? ` ${fid(dKey)}-err` : ""}`}
                      className={`w-full rounded-md border bg-transparent px-4 py-3 text-lg text-fofPaper ${errors[dKey] ? "border-fofRed" : "border-fofGunmetal"}`}
                    />
                    <p className="nums text-right text-xs text-fofGunmetal">
                      {details[i].length}/{DETAILS_MAX}
                    </p>
                    <FieldError id={fid(dKey)} msg={errors[dKey]} />
                  </div>
                </fieldset>
              );
            })}
          </div>
        )}

        {/* ---------------- Step 3 ---------------- */}
        {step === 3 && (
          <div className="space-y-8">
            {CONSENT_SECTIONS.map((sec) => (
              <section key={sec.key} className="space-y-3">
                <LegalText section={sec} />
                {([0, 1] as const).map((i) => {
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
                        <strong>{names[i]}</strong> has read and accepts this section
                      </Tick>
                      <FieldError id={fid(key)} msg={errors[key]} />
                    </div>
                  );
                })}
              </section>
            ))}

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
          </div>
        )}

        {/* ---------------- Step 4 ---------------- */}
        {step === 4 && (
          <div className="space-y-8">
            <section className="space-y-3">
              <h3 className="font-display text-xl tracking-wide text-fofPaper">Final declaration</h3>
              <p className="text-[15px] text-fofGunmetal">Each athlete ticks every statement.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {([0, 1] as const).map((i) => {
                  const all = FINAL_DECLARATION.every((d) => declared[i][d.key]);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={all}
                      onClick={() => {
                        const value = !all;
                        setPair(
                          setDeclared,
                          i,
                          Object.fromEntries(FINAL_DECLARATION.map((d) => [d.key, value])) as Record<string, boolean>
                        );
                        FINAL_DECLARATION.forEach((d) => clearError(`m${i}.decl.${d.key}`));
                      }}
                      className={`tap-target rounded-md border px-3 text-sm font-semibold ${
                        all ? "border-fofRed bg-fofCharcoal text-fofPaper" : "border-fofGunmetal text-fofPaper"
                      }`}
                    >
                      {all ? `✓ All ticked for ${names[i]}` : `Tick all for ${names[i]}`}
                    </button>
                  );
                })}
              </div>
              <ol className="space-y-4">
                {FINAL_DECLARATION.map((d, n) => (
                  <li key={d.key} className="rounded-lg border border-fofRule bg-fofPanel p-4">
                    <p className="text-[15px] leading-relaxed text-fofPaper">
                      <span className="nums mr-2 text-fofGunmetal">{n + 1}.</span>
                      {d.text}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {([0, 1] as const).map((i) => {
                        const key = `m${i}.decl.${d.key}`;
                        return (
                          <Tick
                            key={i}
                            id={fid(key)}
                            checked={!!declared[i][d.key]}
                            error={!!errors[key]}
                            onChange={(v) => {
                              setPair(setDeclared, i, (c) => ({ ...c, [d.key]: v }));
                              clearError(key);
                            }}
                          >
                            {names[i]} agrees
                          </Tick>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="space-y-6">
              <h3 className="font-display text-xl tracking-wide text-fofPaper">Signatures</h3>
              {([0, 1] as const).map((i) => {
                const key = `m${i}.signature`;
                return (
                  <div key={i} id={fid(key)} tabIndex={-1} className="outline-none">
                    <p className="mb-2 font-display text-lg tracking-widest text-fofRed">{names[i].toUpperCase()}</p>
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
                );
              })}
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
            {step < 4 ? "Next" : submitting ? "Registering…" : "Register team"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------
// Confirmation
// ---------------------------------------------------------------------

function Confirmation({ result, event, brand }: { result: Result; event: PublicEvent; brand: Brand }) {
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const idRef = useRef<HTMLParagraphElement>(null);
  const type = useMemo(() => TEAM_TYPES.find((t) => t.division === result.division), [result.division]);
  const firstNames = result.athletes.map((n) => n.trim().split(/\s+/)[0]).filter(Boolean);
  const hello = firstNames.length === 2 ? `${firstNames[0]} & ${firstNames[1]}` : firstNames[0] ?? "";
  const year = event.event_date.slice(0, 4);

  useEffect(() => {
    import("qrcode")
      .then((QR) => QR.toDataURL(`${event.name.toUpperCase()}:${result.teamId}`, { margin: 1, width: 300 }))
      .then(setQr)
      .catch(() => setQr(null));
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [event.name, result.teamId]);

  // Race day, at check-in time, in South African time (UTC+2).
  const raceStart = useMemo(() => {
    const [y, m, d] = event.event_date.slice(0, 10).split("-").map(Number);
    const [hh, mm] = (event.registration_time ?? "06:00").split(":").map((v) => Number(v) || 0);
    return Date.UTC(y, m - 1, d, hh, mm) - 2 * 3600 * 1000;
  }, [event.event_date, event.registration_time]);
  const left = Math.max(0, raceStart - now);
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.teamId);
      setCopied(true);
    } catch {
      // Fallback: select the ID so it can be copied by hand.
      const el = idRef.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        try {
          setCopied(document.execCommand("copy"));
        } catch {
          setCopied(false);
        }
      }
    }
  }

  const signupUrl = typeof window !== "undefined" ? `${window.location.origin}/register` : "/register";
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(
    `We're in ${event.name} on ${formatEventDate(event.event_date)}${event.venue ? ` at ${event.venue}` : ""}! Sign up your team: ${signupUrl}`
  )}`;

  function addToCalendar() {
    const [y, m, d] = event.event_date.slice(0, 10).split("-");
    const start = new Date(raceStart);
    const pad = (n: number) => String(n).padStart(2, "0");
    const utc = (dt: Date) =>
      `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00Z`;
    const end = new Date(raceStart + 5 * 3600 * 1000);
    const esc = (v: string) => v.replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Race Timing//EN",
      "BEGIN:VEVENT",
      `UID:${result.teamId}-${y}${m}${d}@race.betterdesk.app`,
      `DTSTAMP:${utc(new Date())}`,
      `DTSTART:${utc(start)}`,
      `DTEND:${utc(end)}`,
      `SUMMARY:${esc(`${event.name} - ${result.teamName} (${result.teamId})`)}`,
      event.venue ? `LOCATION:${esc(event.venue)}` : "",
      `DESCRIPTION:${esc(`Check-in from ${event.registration_time ?? "06:00"}. Team ID ${result.teamId}. Bring water, a towel and your medical info.`)}`,
      "BEGIN:VALARM",
      "TRIGGER:-P1D",
      "ACTION:DISPLAY",
      `DESCRIPTION:${esc(`${event.name} is tomorrow`)}`,
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .filter(Boolean)
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${event.name}-${result.teamId}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const passHref = result.passToken ? `/api/register/pass?t=${encodeURIComponent(result.passToken)}&download=1` : null;
  const ACTION = "tap-target flex items-center justify-center rounded-md border border-fofRule bg-fofPanel px-3 text-center text-sm text-fofPaper hover:border-fofRed";

  return (
    <div>
      {/* Just the event's logo on top - nothing else. */}
      <img
        src={brand.logo}
        alt={`${event.name} logo`}
        width={150}
        height={150}
        className={`mx-auto h-[150px] w-[150px] ${brand.logoRound ? "logo-round" : "rounded-full"}`}
      />

      <div className="mt-5 text-center">
        <h2 tabIndex={-1} className="font-marker text-4xl leading-tight text-fofPaper">
          Congratulations!
        </h2>
        <p className="font-marker text-2xl text-fofRed">You&apos;re on the island</p>
        <p className="mx-auto mt-3 max-w-sm text-[17px] leading-snug text-fofPaper">
          {hello ? `${hello}, we're ` : "We're "}
          <span className="text-fofRed">so excited</span> to see you
          {event.venue ? ` at ${event.venue}` : ""} on {formatEventDate(event.event_date)}.
        </p>
      </div>

      {/* Island Pass */}
      <section
        aria-label="Island Pass"
        className="relative mt-6 overflow-hidden rounded-2xl border border-fofRed"
        style={{ background: "linear-gradient(160deg, var(--fof-panel), var(--fof-black))" }}
      >
        <div className="flex items-center justify-between border-b border-dashed border-fofRed px-4 py-3" style={{ background: "rgba(var(--fof-glow-rgb), 0.12)" }}>
          <span className="font-display text-sm tracking-[0.18em] text-fofPaper">
            ISLAND PASS · {event.name.toUpperCase()} {year}
          </span>
          {type && <span className="nums text-xs text-fofGunmetal">{type.division.toUpperCase()}</span>}
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            <p className="nums text-[11px] tracking-widest text-fofGunmetal">TEAM ID</p>
            <p ref={idRef} className="nums select-all text-5xl font-semibold leading-none tracking-wider text-fofPaper">
              {result.teamId}
            </p>
            <p className="mt-2 truncate text-lg font-semibold text-fofPaper">{result.teamName}</p>
            <p className="text-sm text-fofGunmetal">
              {result.athletes[0]} &amp; {result.athletes[1]}
            </p>
          </div>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="" className="h-24 w-24 shrink-0 rounded-md bg-white p-1" />
          ) : (
            <div className="h-24 w-24 shrink-0 rounded-md bg-fofCharcoal" />
          )}
        </div>
        <div className="grid grid-cols-3 border-t border-dashed border-fofRed text-center">
          <PassCell label="DATE" value={formatEventDate(event.event_date).replace(/ \d{4}$/, "")} />
          <PassCell label="CHECK-IN" value={event.registration_time ?? "-"} />
          <PassCell label="HEAT" value="Coming soon" last />
        </div>
      </section>
      <p className="mt-2 text-center text-sm text-fofGunmetal">
        Your Team ID stays the same, even when heats change. Show this pass at check-in.
      </p>

      {/* Countdown */}
      {left > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Count value={days} label="DAYS" />
          <Count value={hours} label="HOURS" />
          <Count value={12} label="STATIONS" />
        </div>
      )}

      {/* Actions */}
      <div className="mt-5 grid grid-cols-2 gap-2">
        {passHref && (
          <a
            href={passHref}
            download={`Island-Pass-${result.teamId}.png`}
            className="tap-target btn-stamped col-span-2 flex items-center justify-center rounded-md font-display text-lg tracking-wide"
          >
            Save my Island Pass
          </a>
        )}
        <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${ACTION} border-[#25D366]`}>
          Tell your friends on WhatsApp
        </a>
        <button type="button" onClick={addToCalendar} className={ACTION}>
          Add to my calendar
        </button>
        <button type="button" onClick={copy} className={`${ACTION} col-span-2`}>
          {copied ? "✓ Team ID copied" : "Copy Team ID"}
        </button>
        <p aria-live="polite" className="sr-only">
          {copied ? "Team ID copied" : ""}
        </p>
      </div>

      {!result.loginCreated && (
        <p role="status" className="mt-4 rounded-md border border-fofRed px-4 py-3 text-sm text-fofPaper">
          Your team is registered, but the login couldn&apos;t be created. The organisers will set it up for you.
        </p>
      )}

      {/* What happens next */}
      <section className="mt-6">
        <h3 className="font-display text-xl tracking-wide text-fofPaper">What happens next</h3>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-[15px] text-fofPaper">
          {(event.entry_fee || event.bank_details) && (
            <li>
              <b>Pay your entry fee</b>
              {event.entry_fee ? ` (${event.entry_fee})` : ""}
              <span className="text-fofGunmetal">
                {" "}
                - use <b className="nums text-fofPaper">{result.teamId}</b> as your reference.
              </span>
            </li>
          )}
          <li>
            <b>Your heat</b> <span className="text-fofGunmetal">- we&apos;ll email you your heat and start time.</span>
          </li>
          <li>
            <b>Race day</b>{" "}
            <span className="text-fofGunmetal">
              - check in from {event.registration_time ?? "06:00"}
              {event.venue ? ` at ${event.venue}` : ""} and show your Island Pass.
            </span>
          </li>
        </ol>
        <p className="mt-3 text-sm text-fofGunmetal">
          Your team login is <span className="nums text-fofPaper">{result.username}</span> with the password you chose - use it
          on race day to follow your race live.
        </p>
      </section>

      <section className="mt-5">
        <h3 className="font-display text-xl tracking-wide text-fofPaper">What to bring</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {["Water bottle", "Towel", "Your medical info", "Inhaler / medication", "Sunscreen", "Your partner"].map((x) => (
            <span key={x} className="rounded-full border border-fofRule px-3 py-1 text-sm text-fofGunmetal">
              {x}
            </span>
          ))}
        </div>
      </section>

      {(event.entry_fee || event.bank_details) && (
        <section className="mt-6 rounded-lg border border-fofRed bg-fofPanel p-4">
          <h3 className="font-display text-xl tracking-wide text-fofPaper">Payment</h3>
          {event.entry_fee && <p className="mt-2 text-lg font-semibold text-fofPaper">{event.entry_fee}</p>}
          {event.bank_details && (
            <p className="nums mt-2 whitespace-pre-line text-sm leading-relaxed text-fofPaper">{event.bank_details}</p>
          )}
          <p className="mt-3 text-[15px] text-fofPaper">
            Use your Team ID <span className="nums font-semibold text-fofRed">{result.teamId}</span> as the payment reference.
          </p>
          <p className="mt-2 text-sm text-fofGunmetal">
            Paying separately? Each of you can pay your own share - use{" "}
            <span className="nums text-fofPaper">{result.teamId}</span> and your name, e.g.{" "}
            <span className="nums text-fofPaper">
              {result.teamId} {result.athletes[0].trim().split(/\s+/)[0]}
            </span>
            .
          </p>
        </section>
      )}

      {result.emailed && (
        <p className="mt-5 text-center text-sm text-fofGunmetal">
          We&apos;ve emailed a copy of your Island Pass to both of you.
        </p>
      )}
    </div>
  );
}

function PassCell({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`px-2 py-3 ${last ? "" : "border-r border-dashed border-fofRed"}`}>
      <p className="nums text-[10px] tracking-widest text-fofGunmetal">{label}</p>
      <p className="text-[15px] font-semibold text-fofPaper">{value}</p>
    </div>
  );
}

function Count({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-lg border border-fofRule bg-fofPanel py-2">
      <p className="nums text-2xl leading-none text-fofPaper">{value}</p>
      <p className="mt-1 text-[11px] tracking-widest text-fofGunmetal">{label}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4">
      <dt className="w-28 shrink-0 text-sm text-fofGunmetal">{label}</dt>
      <dd className="text-base text-fofPaper">{children}</dd>
    </div>
  );
}
