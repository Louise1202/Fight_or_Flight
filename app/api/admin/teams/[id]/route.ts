import { NextRequest, NextResponse } from "next/server";
import { isAdminSession } from "@/lib/adminAuth";
import { createAdminClient } from "@/lib/supabase/admin";

const EDITABLE_FIELDS = [
  "team_name",
  "athlete_1",
  "athlete_2",
  "division",
  "wave",
  "start_time",
] as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdminSession()) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const body = await req.json();
  const update: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) update[field] = body[field];
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from("teams").update(update).eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
