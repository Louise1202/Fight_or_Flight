// SERVER-ONLY. The athlete briefing for Survivor ("Liewe Survivor atleet"),
// the organisers' own wording from their final text (received 2026-11-05).
// Only the spelling they approved was corrected: registrasie, kompetisie,
// beoordelaar. Sent by the admin from Registrations, once per
// team, to both athletes, with the team's own heat at the top. Sends are
// recorded in message_sends (sql/026).
import type { createAdminClient } from "@/lib/supabase/admin";
import { brandFor, EventRow } from "@/lib/events";
import { emailConfigured, escapeHtml, fromAddress, sendViaResend } from "@/lib/resultsEmail";
import { heatTimes } from "@/lib/heatEmail";
import { baseUrl } from "@/lib/partnerLink";

type Admin = ReturnType<typeof createAdminClient>;

export const BRIEFING_KEY = "survivor-briefing-1";

const INTRO = [
  "Welkom by deel TWEE van ons reeks kompetisies wat ons beplan.",
  "Ons is bly JY is deel van hierdie lekker dag!",
  "Onder volg ‘n paar reëlings en antwoorde op al jou vrae sodat jy voorbereid is vir die dag wat voorlê",
];

const SECTIONS: { title: string; items: string[] }[] = [
  { title: "1. Ligging", items: ["Kompetisie vind plaas op Die Eiland by die Kalahari Kuierfees Feesterien voor die pawiljoen."] },
  {
    title: "2. Toeskouers",
    items: [
      "Toeskouers is welkom om kompetisie te kom kyk, maar moet asb ten alle tye agter die gemerkte areas bly.",
      "Toeskouers betaal Kuierfees ingangsfooi.",
    ],
  },
  {
    title: "3. Registrasie en opwarming",
    items: [
      "Atlete moet asb Vrydag hul nommers en ingangsbandjies by The Box kom afhaal",
      "Saterdag moet atlete asb 45 min voor deelname by registrasie tafel aanmeld",
      "Daar is ‘n opwarmings area onder die Kuierfees se “kuier tent”",
      "Opwarming is jou eie verantwoordelikheid.",
    ],
  },
  {
    title: "4. Kompetisie",
    items: [
      "Elke span kry ‘n stasie om deel te neem, by jou stasie is al die regte gewigte wat jy nodig het vir die kompetisie.",
      "Elke span kry 1 beoordelaar wat jou reps gaan tel en seker maak jy voldoen aan die regte bewegings standaarde- respekteer asb beoordelaar.",
      "Beoordelaar mag jou help met volgorde van die bewegings, asook regte gewigte.",
      "Kompetisie begin by jou stasie.",
      "Atleet 1 hardloop 200m en tag dan deelnemer 2",
      "Deelnemer 2 hardloop dan ook 200m en eindig weer by jou stasie waar jy dan oefening gaan doen",
      "Elke span het een (1) uur om kompetisie klaar te maak, sou jul nie klaar kry nie sal jou beoordelaar jou laaste reps neerskryf en daarvolgens word jou punte bereken",
    ],
  },
  { title: "5. Water", items: ["Deelnemers mag hul eie waterbottels, handoeke by hul stasie hou"] },
  {
    title: "6. Fotograaf",
    items: ["Daar is ‘n fotograaf wat die hele dag se byeenkoms gaan afneem", "Fotos is na die tyd direk by hom te koop."],
  },
  {
    title: "7. Noodhulp",
    items: [
      "Daar is ‘n noodhulp sak beskikbaar vir klein beserings",
      "Indien jy weet jy het ‘n allergie of asma, bring asb reeds nodige medikasie en asma pompie saam.",
      "Die hele byeenkoms vind buite plaas, indien jy sensitief is vir stof, wees asb voorbereid.",
    ],
  },
];

const TURN = "Moet oor die lyn gaan om te draai/laaste rep te gee";
const STATIONS: { title: string; items: string[] }[] = [
  { title: "1. 240m KB Farmers Carry (2 x 24/16)", items: ["8 x 30m", "Geen neersit van KB", "Slegs agtertoe aangee", TURN] },
  { title: "2. 60 x KB Deadlift (32/20)", items: ["KB moet vloer raak", "Moet heel regop kom; knieë, heupe reguit"] },
  {
    title: "3. 60m DB Lunges (2 x 12.5/7.5)",
    items: [
      "2 x 30m",
      "Knie moet elke keer die grond raak en jou hele lyf moet elke keer heel regop kom",
      "Geen neersit van DB",
      "Slegs agtertoe aangee",
      TURN,
    ],
  },
  {
    title: "4. 60 x DB Snatches (15/10)",
    items: ["Hele DB moet die grond raak", "Moet hande afwissel", "DB moet reguit bo kop eindig", "Reguit arm, heup en knieë"],
  },
  {
    title: "5. 60m Burpee broad jump",
    items: [
      "2 x 30m",
      "Bors en bo bene raak grond",
      "Spring en land met beide voete bymekaar",
      "Mag burpee spring, of in/uit trap",
      "Atleet 2 begin burpee waar atleet 1 se voete geland het",
      TURN,
    ],
  },
  {
    title: "6. 60 x KB Goblet Squat (16/12)",
    items: ["DB word voor teen bors houvas- goblet posisie", "Squat moet dieper as 90° wees", "Moet heel regop kom; knieë, heupe reguit"],
  },
  {
    title: "7. 240m WP Front Carry (25/20)",
    items: ["8 x 30m", "WP mag met enige vorm van grip gedra word, slegs voor jou bors", "Geen neersit van plate", "Slegs agtertoe aangee", TURN],
  },
  { title: "8. 60 x DB Push Press (2 x 12.5/6)", items: ["DB moet skouers raak", "Arms moet heel reguit wanneer press"] },
  {
    title: "9. 120m Bear Crawl",
    items: [
      "4 x 30m",
      "Moet hande en voete gebruik vir kruip bewegings",
      "Mag nie op knieë kruip nie",
      "Boude mag nie in die lig wees nie",
      "Atleet 2 begin bear crawl waar atleet 1 gestop het",
      TURN,
    ],
  },
  {
    title: "10. 60 x WP Clean + Press (15/10)",
    items: ["Gedeelte van die WP moet grond raak", "Arms moet heel reguit wees wanneer press", "WP moet direk bo die kop wees"],
  },
  {
    title: "11. 180m WP Overhead Carry (15/10)",
    items: ["6 x 30m", "Arms moet reguit wees- WP moet direk bo die kop wees", "Geen neersit van WP", "Slegs agtertoe aangee", TURN],
  },
  {
    title: "12. 20 x DB Devils Press (2 x 10/5)",
    items: ["DB in elke hand", "Gaan af in burpee, bors en bo bene moet die grond raak", "Mag burpee spring, of in/uit trap", "Press DB direk bo kop uit"],
  },
];

const GENERAL_RULES = [
  "Tydens die volgende oefeninge mag geen toerusting op die vloer neergesit word nie, maar moet AGTERTOE aangegee word na spanmaat. Neersit = 2 min straf (KB Farmers Carry, DB Lunges, WP Front Carry en WP Overhead Carry)",
  "Gooi,hard laat val van enige toerusting = 2 min straf",
  "Geen toerusting mag van die mat af tensy dit geneem word na die volgende stasis = 2 min straf",
  "Atleet wat oefening doen moet op swart mat wees, ander atleet direk langs die mat",
  "Albei atlete moet saam beweeg met alle oefeninge",
  "Atleet 1 hardloop 200m en daarna hardloop atleet 2 ook 200m",
  "Atleet 1 mag nie stasie begin voor atleet 2 nie daar is nie",
  "Geen chalk mag gebruik word nie",
  "Enige handskoene en knee sleaves is welkom",
  "Elke span het een (1) uur om kompetisie klaar te maak, sou jul nie klaar kry nie sal jou beoordelaar jou laaste reps neerskryf en daarvolgens word jou punte bereken",
];

export type BriefingTeam = {
  id: string;
  team_name: string | null;
  wave: number | null;
  scheduled_start: string | null;
  emails: string[];
};

const H2 = "font-size:16px;margin:20px 0 6px 0;padding-bottom:4px;border-bottom:2px solid #2E9BFF;";
const H3 = "font-size:15px;margin:14px 0 4px 0;";
const UL = "margin:4px 0;padding-left:20px;";

function list(items: string[]): string {
  return `<ul style="${UL}">${items.map((i) => `<li style="margin-bottom:3px;">${escapeHtml(i)}</li>`).join("")}</ul>`;
}

export function renderBriefing(event: EventRow, team: BriefingTeam, opts: { test?: boolean } = {}) {
  const name = team.team_name || `Team ${team.id}`;
  const times = team.scheduled_start ? heatTimes(team.scheduled_start) : null;
  const logo = `${baseUrl()}${brandFor(event).logo}`;
  const dv = `${baseUrl()}/brand/datavera-light.png`;
  const box = `${baseUrl()}/partners/the-box.png`;
  const m2m = `${baseUrl()}/partners/mission-to-move.png`;

  const heatBox =
    times && team.wave != null
      ? `<div style="border:2px dashed #2E9BFF;border-radius:12px;background:#F3F8FF;padding:12px;text-align:center;margin:12px 0;">
<b>${escapeHtml(name)} (${escapeHtml(team.id)}): Heat ${team.wave}</b><br>Begin ${times.start} · Meld aan teen ${times.arrive}
</div>`
      : "";

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#EEF2F7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F7;padding:20px 0;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#111827;">
<tr><td align="center" style="background:#050B18;padding:24px 20px;">
<img src="${logo}" width="84" height="84" alt="${escapeHtml(event.name)}" style="border-radius:42px;display:block;">
<div style="font-size:24px;font-weight:bold;color:#ffffff;margin-top:14px;">Liewe Survivor atleet</div>
<div style="font-size:16px;font-weight:bold;color:#2E9BFF;margin-top:4px;">Saterdag 7 November · Die Eiland</div>
</td></tr>
<tr><td style="padding:20px 22px;font-size:15px;line-height:1.55;">
${opts.test ? '<p style="margin:0 0 10px 0;padding:8px;border:1px dashed #2E9BFF;font-size:13px;">This is a test email - it shows what the teams will get.</p>' : ""}
${INTRO.map((p) => `<p style="margin:0 0 10px 0;">${escapeHtml(p)}</p>`).join("")}
${heatBox}
${SECTIONS.map((s) => `<div style="${H2}font-weight:bold;">${escapeHtml(s.title)}</div>${list(s.items)}`).join("")}
<div style="${H2}font-weight:bold;">Reëls van elke stasie</div>
${STATIONS.map((s) => `<div style="${H3}font-weight:bold;">${escapeHtml(s.title)}</div>${list(s.items)}`).join("")}
<div style="background:#FFF4F4;border:1px solid #F3C4C4;border-radius:8px;padding:10px 12px;margin-top:14px;">${list(GENERAL_RULES)}</div>
<p style="margin:18px 0 0 0;">Groete, Liefde<br><b>Marica en Louise</b></p>
</td></tr>
<tr><td align="center" style="background:#F4F6FA;padding:16px 20px;font-size:11px;color:#5B6680;line-height:1.5;">
<img src="${box}" height="30" alt="The Box" style="height:30px;margin:0 8px;"><img src="${m2m}" height="30" alt="Mission To Move" style="height:30px;margin:0 8px;">
<div style="margin-top:8px;">You're getting this because you registered for ${escapeHtml(event.name)} (Team ${escapeHtml(team.id)}).</div>
<img src="${dv}" height="20" alt="by Datavera Analytics" style="height:20px;margin-top:8px;">
</td></tr>
</table></td></tr></table></body></html>`;

  const block = (s: { title: string; items: string[] }) => [s.title, ...s.items.map((i) => `- ${i}`), ""].join("\n");
  const text = [
    opts.test ? "TEST EMAIL\n" : "",
    "Liewe Survivor atleet\n",
    ...INTRO,
    "",
    times && team.wave != null ? `${name} (${team.id}): Heat ${team.wave} - Begin ${times.start}, meld aan teen ${times.arrive}\n` : "",
    ...SECTIONS.map(block),
    "Reëls van elke stasie\n",
    ...STATIONS.map(block),
    ...GENERAL_RULES.map((r) => `- ${r}`),
    "",
    "Groete, Liefde",
    "Marica en Louise",
  ].join("\n");

  return {
    subject: `${opts.test ? "[Test] " : ""}${event.name}: reëlings vir Saterdag (${team.id})`,
    html,
    text,
  };
}

/** Every team that hasn't withdrawn, with its heat if it has one. */
export async function loadBriefingTeams(admin: Admin, event: EventRow): Promise<BriefingTeam[]> {
  const [{ data: teams }, { data: waves }] = await Promise.all([
    admin.from("teams").select("id, team_name, wave").eq("event_id", event.id).neq("status", "withdrawn").order("id"),
    admin.from("waves").select("wave_number, scheduled_start").eq("event_id", event.id),
  ]);
  const start = new Map((waves ?? []).map((w) => [w.wave_number as number, w.scheduled_start as string]));
  const ids = (teams ?? []).map((t) => t.id as string);
  const { data: members } = ids.length
    ? await admin.from("team_members").select("team_id, email").in("team_id", ids)
    : { data: [] as { team_id: string; email: string }[] };
  return (teams ?? []).map((t) => ({
    id: t.id as string,
    team_name: t.team_name as string | null,
    wave: t.wave as number | null,
    scheduled_start: t.wave != null ? start.get(t.wave as number) ?? null : null,
    emails: [
      ...new Set(
        (members ?? [])
          .filter((m) => m.team_id === t.id)
          .map((m) => (m.email ?? "").trim().toLowerCase())
          .filter(Boolean)
      ),
    ],
  }));
}

export async function sendBriefing(admin: Admin, event: EventRow, team: BriefingTeam): Promise<"sent" | "failed" | "no_email"> {
  if (!emailConfigured()) return "failed";
  if (team.emails.length === 0) return "no_email";
  const msg = renderBriefing(event, team);
  const r = await sendViaResend({ from: fromAddress(event), to: team.emails, subject: msg.subject, html: msg.html, text: msg.text });
  await admin.from("message_sends").upsert(
    {
      team_id: team.id,
      message_key: BRIEFING_KEY,
      status: r.ok ? "sent" : "failed",
      recipients: team.emails.length,
      sent_at: new Date().toISOString(),
    },
    { onConflict: "team_id,message_key" }
  );
  return r.ok ? "sent" : "failed";
}
