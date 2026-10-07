// Field rules for team self-registration, shared by the sign-up form
// (friendly messages while typing) and app/api/register/route.ts (the
// real check). Pure functions only - safe in browser and server code.

export const NAME_MAX = 60;
export const TEAM_NAME_MAX = 40;
export const EMAIL_MAX = 120;
export const RELATIONSHIP_MAX = 40;
export const DETAILS_MAX = 1000;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // bcrypt limit used by Supabase Auth
export const SIGNATURE_MAX_BYTES = 300 * 1024;

/** Trim and collapse runs of whitespace to one space. */
export function collapseSpaces(v: string): string {
  return v.replace(/\s+/g, " ").trim();
}

const NAME_RE = /^[\p{L}][\p{L}\p{M} '.\-]*$/u;

/** First name, surname, emergency contact name: letters, spaces, ' - . */
export function cleanPersonName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = collapseSpaces(v);
  if (s.length < 1 || s.length > NAME_MAX) return null;
  return NAME_RE.test(s) ? s : null;
}

/**
 * South African phone numbers: 0xx xxx xxxx or +27 xx xxx xxxx.
 * Returns the 10-digit local form ("0821234567") or null.
 */
export function normalisePhone(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.replace(/[\s\-().]/g, "");
  if (s.startsWith("+27")) s = "0" + s.slice(3);
  else if (s.startsWith("0027")) s = "0" + s.slice(4);
  else if (/^27\d{9}$/.test(s)) s = "0" + s.slice(2);
  return /^0\d{9}$/.test(s) ? s : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (s.length < 5 || s.length > EMAIL_MAX) return null;
  return EMAIL_RE.test(s) ? s : null;
}

/** Optional relationship ("Mother", "Partner"). "" when left blank. */
export function cleanRelationship(v: unknown): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  const s = collapseSpaces(v);
  if (s.length > RELATIONSHIP_MAX) return null;
  if (s && !NAME_RE.test(s)) return null;
  return s;
}

/**
 * Optional team name. "" = left blank (the database then names the team
 * "Team <Team ID>"). null = not allowed.
 */
export function cleanTeamName(v: unknown): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return null;
  const s = collapseSpaces(v);
  if (s.length > TEAM_NAME_MAX) return null;
  // No control characters or angle brackets.
  if (/[\u0000-\u001f\u007f<>]/.test(s)) return null;
  return s;
}

/** "Team SV024" style names are kept for teams that leave the name blank. */
export function isReservedTeamName(name: string): boolean {
  return /^team\s*[a-z]{2,4}\s*\d+$/i.test(name.trim());
}

/** Same comparison the database's unique index uses: lower(trim(name)). */
export function teamNameKey(name: string): string {
  return collapseSpaces(name).toLowerCase();
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

export function isSignaturePng(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (!v.startsWith("data:image/png;base64,")) return false;
  if (v.length > SIGNATURE_MAX_BYTES) return false;
  return /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(v);
}
