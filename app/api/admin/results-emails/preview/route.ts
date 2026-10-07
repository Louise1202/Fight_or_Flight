import { NextRequest, NextResponse } from "next/server";
import { previewEmail } from "@/lib/resultsEmail";
import { adminContext, fail, teamInEvent } from "../../_lib/guard";

// "Preview email": the results email of one team of the ACTIVE event as a
// web page. GET ?teamId=SV001&kind=heat|final. No link is created and
// nothing is sent.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ctx = await adminContext();
  if (ctx.res) return ctx.res;
  const { admin, event } = ctx;

  const teamId = req.nextUrl.searchParams.get("teamId") ?? "";
  const kind = req.nextUrl.searchParams.get("kind") === "final" ? "final" : "heat";
  if (!teamId) return fail("Choose a team.");

  try {
    const team = await teamInEvent(admin, teamId, event.id);
    if (!team) return fail("That team isn't in the active event.", 404);
    const email = await previewEmail(admin, event, teamId, kind);
    if (!email) return fail("That team isn't in the active event.", 404);
    const page = email.html.replace(
      /(<body[^>]*>)/,
      (bodyTag) => `${bodyTag}<div style="font-family:Arial,sans-serif;font-size:13px;background:#FFF8E1;color:#5B4500;padding:10px 16px;border-bottom:1px solid #F0D98C;">Subject: <strong>${email.subject
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</strong> - preview only, the buttons' links don't work here.</div>`
    );
    return new NextResponse(page, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch {
    console.error("admin/results-emails/preview: failed");
    return fail("Couldn't build the preview.", 500);
  }
}
