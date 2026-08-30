// Judges and team viewers log in with a plain username + password.
// Supabase Auth is email-based under the hood, so we deterministically
// map "nicolene" -> "nicolene@judges.fightorflight" before ever calling
// Supabase. Nobody sees this address - it's purely internal plumbing.
const FAKE_DOMAIN = process.env.NEXT_PUBLIC_AUTH_FAKE_DOMAIN || "judges.fightorflight";

export function usernameToEmail(username: string): string {
  const clean = username.trim().toLowerCase().replace(/\s+/g, "");
  return `${clean}@${FAKE_DOMAIN}`;
}
