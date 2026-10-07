import { NextResponse } from "next/server";

// The server's clock, for judges' phones to measure how far their own
// clock is off (see lib/clock.ts). Every scan is stamped by the phone,
// but each heat's start is stamped by the server, so a phone running a
// minute fast would otherwise add a minute to every team it times.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { now: Date.now() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
