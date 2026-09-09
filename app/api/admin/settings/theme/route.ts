import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(req: NextRequest) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }
  const { theme } = await req.json();
  if (theme !== "dark" && theme !== "light") {
    return NextResponse.json({ error: "theme must be 'dark' or 'light'" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("app_settings").upsert({ id: 1, theme });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, theme });
}
