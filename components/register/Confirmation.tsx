"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TEAM_TYPES, formatEventDate, type Brand, type Division } from "@/lib/events";
import type { PublicEvent } from "@/components/register/EventHeader";

// The last screens of sign-up:
//  - Confirmation: everyone has signed - "You're on the island" + Island Pass
//  - Booked: athlete 1 signed, waiting for athlete 2 to sign from their link

export type RegisterResult = {
  teamId: string;
  username: string;
  loginCreated: boolean;
  teamName: string;
  division: Division | null;
  athletes: [string, string];
  /** Signed token for the Island Pass picture (null if the server didn't send one). */
  passToken: string | null;
  /** Whether the email went out (Island Pass, or the partner's sign link). */
  emailed: boolean;
  status: "booked" | "confirmed";
  /** Booked only: athlete 2's personal sign link token. */
  signToken: string | null;
  /** Shown to athlete 2 after signing from their link. */
  partnerView?: boolean;
  /** Athlete 1's first name (partner view: who chose the password). */
  bookerFirstName?: string;
};

function firstName(n: string) {
  return n.trim().split(/\s+/)[0] ?? "";
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(what: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
    } catch {
      window.prompt("Copy this:", value);
    }
  }
  return { copied, copy };
}

const ACTION =
  "tap-target flex items-center justify-center rounded-md border border-fofRule bg-fofPanel px-3 text-center text-sm text-fofPaper hover:border-fofRed";

function PaymentBox({ event, teamId, payerFirstName }: { event: PublicEvent; teamId: string; payerFirstName: string }) {
  if (!event.entry_fee && !event.bank_details) return null;
  return (
    <section className="mt-6 rounded-lg border border-fofRed bg-fofPanel p-4">
      <h3 className="font-display text-xl tracking-wide text-fofPaper">Payment</h3>
      {event.entry_fee && <p className="mt-2 text-lg font-semibold text-fofPaper">{event.entry_fee}</p>}
      {event.bank_details && (
        <p className="nums mt-2 whitespace-pre-line text-sm leading-relaxed text-fofPaper">{event.bank_details}</p>
      )}
      <p className="mt-3 text-[15px] text-fofPaper">
        Use your Team ID <span className="nums font-semibold text-fofRed">{teamId}</span> as the payment reference.
      </p>
      <p className="mt-2 text-sm text-fofGunmetal">
        Paying separately? Each of you can pay your own share - use <span className="nums text-fofPaper">{teamId}</span> and
        your name, e.g.{" "}
        <span className="nums text-fofPaper">
          {teamId} {payerFirstName}
        </span>
        .
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------
// Booked: waiting for the partner
// ---------------------------------------------------------------------

export function Booked({ result, event, brand }: { result: RegisterResult; event: PublicEvent; brand: Brand }) {
  const { copied, copy } = useCopy();
  const partner = firstName(result.athletes[1]) || "your partner";
  const me = firstName(result.athletes[0]);
  const link =
    typeof window !== "undefined" && result.signToken
      ? `${window.location.origin}/register/sign?t=${encodeURIComponent(result.signToken)}`
      : null;
  const whatsapp = link
    ? `https://wa.me/?text=${encodeURIComponent(
        `${partner}, I signed us up for ${event.name} on ${formatEventDate(event.event_date)} (${result.teamName}, ${result.teamId}). Please fill in your details and sign here to confirm our spot: ${link}`
      )}`
    : null;

  return (
    <div>
      <img
        src={brand.logo}
        alt={`${event.name} logo`}
        width={150}
        height={150}
        className={`mx-auto h-[150px] w-[150px] ${brand.logoRound ? "logo-round" : "rounded-full"}`}
      />
      <div className="mt-5 text-center">
        <p className="mx-auto inline-block rounded-full border border-fofRed px-3 py-1 text-xs tracking-widest text-fofRed">
          SPOT BOOKED · SIGNED 1 OF 2
        </p>
        <h2 tabIndex={-1} className="mt-3 font-marker text-4xl leading-tight text-fofPaper">
          Spot booked!
        </h2>
        <p className="mx-auto mt-3 max-w-sm text-[17px] leading-snug text-fofPaper">
          {me ? `${me}, your` : "Your"} spot is booked. It&apos;s <span className="text-fofRed">confirmed</span> as soon as{" "}
          {partner} signs.
        </p>
      </div>

      <section className="mt-6 rounded-2xl border border-dashed border-fofRed bg-fofPanel p-4 text-center">
        <p className="nums text-[11px] tracking-widest text-fofGunmetal">TEAM ID</p>
        <p className="nums text-5xl font-semibold leading-none tracking-wider text-fofPaper">{result.teamId}</p>
        <p className="mt-2 text-lg font-semibold text-fofPaper">{result.teamName}</p>
      </section>

      <section className="mt-5 rounded-lg border border-fofRule bg-fofPanel p-4">
        <h3 className="font-display text-xl tracking-wide text-fofPaper">One step left: {partner} signs</h3>
        <p className="mt-2 text-[15px] text-fofPaper">
          {result.emailed
            ? `We've emailed ${partner} a personal link. They fill in their own details, medical questions and the waiver, and sign with their finger.`
            : `Send ${partner} this personal link. They fill in their own details, medical questions and the waiver, and sign with their finger.`}
        </p>
        <div className="mt-3 grid gap-2">
          {whatsapp && (
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="tap-target btn-stamped flex items-center justify-center rounded-md font-display text-lg tracking-wide">
              Send {partner} the link on WhatsApp
            </a>
          )}
          {link && (
            <button type="button" onClick={() => copy("link", link)} className={ACTION}>
              {copied === "link" ? "✓ Link copied" : "Copy the link"}
            </button>
          )}
          <button type="button" onClick={() => copy("id", result.teamId)} className={ACTION}>
            {copied === "id" ? "✓ Team ID copied" : "Copy Team ID"}
          </button>
        </div>
        <p className="mt-3 text-sm text-fofGunmetal">
          When {partner} has signed, you&apos;ll both get your Island Pass by email.
        </p>
      </section>

      {!result.loginCreated && (
        <p role="status" className="mt-4 rounded-md border border-fofRed px-4 py-3 text-sm text-fofPaper">
          Your spot is booked, but the team login couldn&apos;t be created. The organisers will set it up for you.
        </p>
      )}

      <PaymentBox event={event} teamId={result.teamId} payerFirstName={me} />

      <p className="mt-4 text-sm text-fofGunmetal">
        Your team login is <span className="nums text-fofPaper">{result.username}</span> with the password you chose - use it on
        race day to follow your race live.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Confirmation: everyone has signed
// ---------------------------------------------------------------------

export function Confirmation({ result, event, brand }: { result: RegisterResult; event: PublicEvent; brand: Brand }) {
  const { copied, copy } = useCopy();
  const [qr, setQr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const idRef = useRef<HTMLParagraphElement>(null);
  const type = useMemo(() => TEAM_TYPES.find((t) => t.division === result.division), [result.division]);
  const firstNames = result.athletes.map(firstName).filter(Boolean);
  const hello = firstNames.length === 2 ? `${firstNames[0]} & ${firstNames[1]}` : firstNames[0] ?? "";
  const year = event.event_date.slice(0, 4);
  const payer = result.partnerView ? firstName(result.athletes[1]) : firstName(result.athletes[0]);

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
        <button type="button" onClick={() => copy("id", result.teamId)} className={`${ACTION} col-span-2`}>
          {copied === "id" ? "✓ Team ID copied" : "Copy Team ID"}
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
          Your team login is <span className="nums text-fofPaper">{result.username}</span> with the password{" "}
          {result.partnerView ? `${result.bookerFirstName || "your partner"} chose` : "you chose"} - use it on race day to follow
          your race live.
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

      <PaymentBox event={event} teamId={result.teamId} payerFirstName={payer} />

      {result.emailed && (
        <p className="mt-5 text-center text-sm text-fofGunmetal">We&apos;ve emailed a copy of your Island Pass to both of you.</p>
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
