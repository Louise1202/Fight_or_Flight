import { NextRequest } from "next/server";
import { firstNameUsername, usernameToEmail } from "@/lib/username";
import { adminContext, fail, json, readBody } from "../../_lib/guard";

// Always dynamic - this hits the live database on every request.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Sets every ACTIVE judge's login at once: username = their first name,
// password = the one the admin typed. Inactive judges are left alone. The
// password is never stored here or logged.
export async function POST(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin } = ctx;

  const body = await readBody(req);
  const password = typeof body?.password === "string" ? body.password : "";
  if (password.length < 6 || password.length > 72) return fail("The password must be at least 6 characters.");

  const { data: judges, error } = await admin.from("judges").select("id, name").eq("active", true).order("name");
  if (error) return fail("Couldn't load the judges.", 500);

  const seen = new Set<string>();
  const failed: string[] = [];
  let updated = 0;
  for (const judge of judges ?? []) {
    const username = firstNameUsername(judge.name).toLowerCase();
    if (!username || seen.has(username)) {
      failed.push(judge.name);
      continue;
    }
    seen.add(username);
    const { error: authError } = await admin.auth.admin.updateUserById(judge.id, {
      email: usernameToEmail(username),
      password,
    });
    if (authError) failed.push(judge.name);
    else updated += 1;
  }
  return json({ ok: true, updated, failed });
}
