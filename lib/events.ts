// An "event" is one edition of the race (Fight or Flight 19 Sept 2026,
// Survivor 7 Nov 2026, ...). Every team, heat and station belongs to
// exactly one event - see sql/019_multi_event.sql. A finished event is
// locked by the database itself, so its results can never be changed.
//
// Safe to import from browser code: nothing here touches a secret.

export type EventTheme = "fof" | "survivor";

export type EventRow = {
  id: string;
  name: string;
  event_date: string; // YYYY-MM-DD
  venue: string | null;
  registration_time: string | null; // e.g. "06:00", shown as-is
  theme: EventTheme;
  team_id_prefix: string; // "FF", "SV"
  team_id_scheme: "heat_position" | "sequential";
  next_team_number: number;
  heat_minutes: number;
  registration_open: boolean;
  entry_fee: string | null;
  bank_details: string | null;
  status: "setup" | "live" | "finished";
  locked: boolean;
};

export const EVENT_COLUMNS =
  "id, name, event_date, venue, registration_time, theme, team_id_prefix, team_id_scheme, next_team_number, heat_minutes, registration_open, entry_fee, bank_details, status, locked";

export type Brand = {
  /** Shown in page titles, report headers and the browser tab. */
  title: string;
  /** Round badge / logo, served from /public. */
  logo: string;
  /** Whether the logo is a square image that should be shown cut to a circle. */
  logoRound: boolean;
  /** PNG under /public used inside Excel reports (Excel can't embed webp). */
  reportLogo: string;
  /** Partner logos shown on the login and sign-up pages. */
  partners: { src: string; alt: string }[];
  /** Excel header colours (ARGB) for reports. */
  excel: { dark: string; accent: string; light: string; band: string };
};

const PARTNERS = [
  { src: "/partners/the-box.png", alt: "The Box Fitness Center Upington" },
  { src: "/partners/mission-to-move.png", alt: "Mission To Move" },
];

const BRANDS: Record<EventTheme, Omit<Brand, "title">> = {
  fof: {
    logo: "/logo.png",
    logoRound: false,
    reportLogo: "logo.png",
    partners: PARTNERS,
    excel: { dark: "FF0E0D0C", accent: "FFE8262D", light: "FFF4F1EA", band: "FFF4F1EA" },
  },
  survivor: {
    logo: "/events/survivor/logo-512.png",
    logoRound: true,
    reportLogo: "events/survivor/logo-180.png",
    partners: PARTNERS,
    excel: { dark: "FF050B18", accent: "FF2E9BFF", light: "FFEEF4FF", band: "FFEAF3FF" },
  },
};

export function brandFor(event: Pick<EventRow, "name" | "theme"> | null | undefined): Brand {
  const theme: EventTheme = event?.theme ?? "fof";
  return { title: event?.name ?? "Fight or Flight", ...BRANDS[theme] };
}

/** "7 Nov 2026" from "2026-11-07", without any timezone shifting. */
export function formatEventDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d} ${months[m - 1]} ${y}`;
}

/** Division as stored ("Men" | "Women" | "Mixed") from the poster's team type. */
export const TEAM_TYPES = [
  { division: "Men", label: "Male / Male", genders: ["male", "male"] },
  { division: "Women", label: "Female / Female", genders: ["female", "female"] },
  { division: "Mixed", label: "Male / Female", genders: ["male", "female"] },
] as const;

export type Division = (typeof TEAM_TYPES)[number]["division"];

/**
 * Human-readable message for the database's own error codes (see the
 * RT0xx codes in sql/019). Never shows raw database text to a judge.
 */
export function friendlyDbError(code: string | undefined, fallback: string): string {
  switch (code) {
    case "RT001":
      return "This event is finished and locked - its results can't be changed.";
    case "RT002":
      return "This team already has results recorded. Withdraw it instead of deleting it.";
    case "RT003":
      return "A team's ID can't change once its heat has started.";
    case "RT004":
      return "This heat has ended - scanning is closed.";
    case "RT011":
      return "Registration for this event is closed.";
    case "23505":
      return "That already exists.";
    case "42501":
      return "You're not allowed to do that for this team.";
    default:
      return fallback;
  }
}
