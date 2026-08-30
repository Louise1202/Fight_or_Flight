# Project audit request: Fight or Flight race timing app

I've had an AI assistant (Claude) build a web app for timing a team fitness
race, and I want you to review it critically: tell me what's missing, what's
fragile, and what you'd improve. Here's the full picture of what exists.

## The event

- "Fight or Flight" — a team fitness race, 19 September 2026
- 30 teams of 2 people each
- Teams are released in 4 waves of up to 8 teams, 15 minutes apart
  (07:30, 07:45, 08:30, 08:45)
- Each team's route: 400m run → Station 1 → 400m run → Station 2 → ... →
  Station 12 → 400m run → finish line (12 stations total, each preceded by
  a run)
- One judge is assigned to each team and follows them for the entire race,
  scanning the team's QR code at every station

## Tech stack

- Next.js 14 (App Router), TypeScript, Tailwind CSS
- Supabase (Postgres database + Auth), using the free tier
- Deployed on Vercel, connected to a GitHub repo
- html5-qrcode library for browser-based camera QR scanning (no native app)

## Database schema (Postgres via Supabase)

```sql
teams (id text primary key, team_name, athlete_1, athlete_2, division, wave, start_time)
judges (id uuid primary key references auth.users, name)
team_viewers (id uuid primary key references auth.users, team_id references teams)
judge_team_assignments (judge_id references judges, team_id references teams) -- many-to-many
scans (id, team_id, station_number int, event_type 'arrive'|'leave', scanned_at, judge_id)
penalties (id, team_id, station_number, penalty_seconds, judge_id, created_at, notes)
```

Station numbers run 1–12 for the actual stations; station 13 is used as a
special case meaning "finish line crossed" (only ever has an "arrive" event,
no "leave").

## Row Level Security (RLS)

RLS is enabled on every table. Policies:
- A judge can only `select`/`insert` scans and penalties for teams they're
  assigned to (via `judge_team_assignments`)
- A team viewer can only `select` their own team's rows
- Judges can `delete` their own team's scans (used for an "undo last scan"
  button)
- No RLS policy grants broad/public read access to any table — the
  anon key alone cannot read teams, scans, or penalties for teams a
  session isn't authorized for

## Authentication approach

Supabase Auth is fundamentally email + password. Since I wanted plain
**username + password** logins for non-technical judges (no emails to
manage), usernames are deterministically converted to a fake internal
email before ever touching Supabase Auth: `nicolene` becomes
`nicolene@judges.fightorflight` (domain configurable via an env var). This
happens client-side in the login form; the "email" never appears anywhere
a person sees. `auth.uid()` and all RLS policies work identically either
way, since Supabase Auth doesn't care that the email is synthetic.

Judge and team-viewer accounts are currently created manually in the
Supabase dashboard (Authentication → Add User, with "Auto Confirm User"
ticked), then linked into the `judges` / `team_viewers` tables via SQL
using the generated UUID.

The `/admin` dashboard uses a *different*, much simpler auth mechanism: a
single shared password stored in an env var (`ADMIN_PASSWORD`), checked
via a SHA-256 hash stored in an httpOnly cookie. This is intentionally not
a full user system, since only the race organizer uses it.

## Pages / routes

- `/login` — username + password login for judges and team viewers
- `/judge` — a judge's list of assigned teams with live next-action preview
- `/judge/[teamId]` — the scan screen:
  - One primary button: "Scan QR code" (opens device camera)
  - The app infers whether the next scan should be "arrive" or "leave" and
    for which station, purely from the scan history already logged — the
    judge never picks anything manually
  - Manual text-entry fallback if the camera fails
  - "Undo last scan" button
  - Inline penalty logging (seconds + optional note)
  - Offline handling: if a scan insert fails (no network), it's queued in
    `localStorage` and retried automatically every 15s or on the browser's
    `online` event
- `/team/[teamId]` — a team's own live splits and final time, subscribed to
  Supabase Realtime so it updates the instant their judge scans (no manual
  refresh)
- `/admin` — password-gated dashboard:
  - Editable table of all 30 teams (name, athletes, division, wave, start
    time), saved via a server-side API route using the Supabase
    **service role key** (bypasses RLS; the key never reaches the browser)
  - Judge ↔ team assignment management (add/remove)
- `/leaderboard` — public, no login required. Meant for a projector or
  spectators' phones. Shows:
  - Finished teams, ranked by final time (raw time + penalties)
  - Teams currently on course, with current station and live elapsed time
  - Teams not yet started
  - This is deliberately *not* built on open RLS policies — it fetches
    through a small server-side API route using the service role key, so
    the "public" part of this page is a controlled read-only view, not a
    weakening of the database's actual access rules

## Known gaps / things not built yet

1. **No CSV/spreadsheet export.** The original event was run from an Excel
   workbook (Race HQ, Teams, Waves, Finish Scans, Penalties, Backup Timing
   sheets). There's no way yet to export the live data back into that
   format for record-keeping or a backup printout.
2. **No station-side QR codes.** The system assumes every team visits
   stations 1→12 strictly in order. If a team ever got out of sequence
   (skipped one, went backwards), there's no station-side verification to
   catch it — it would just silently record whatever "next" scan comes in
   as the next station in sequence.
3. **Judge/team account creation is fully manual.** Every judge and every
   team's login has to be created one-by-one in the Supabase dashboard,
   then linked via hand-written SQL. There's no admin UI to do this yet —
   it's the single most tedious remaining task before race day, especially
   for 30 teams.
4. **No automated tests.** Nothing has been tested beyond manual
   click-through — no unit tests on the timing logic (`getNextAction`,
   `buildSplits`, `computeStandings`), no integration tests on the RLS
   policies.
5. **No monitoring/alerting.** If the app goes down mid-race, or Supabase
   hits its free-tier limits, there's no alerting — the organizer would
   only find out by noticing the app stopped working.
6. **Offline handling is scan-level only, not page-level.** If a judge's
   phone loses signal, individual scans queue and retry, but the page
   itself doesn't work fully offline (e.g. it can't show "next expected
   scan" correctly if it can't load the team's existing scan history in
   the first place, on a cold load with no signal).
7. **No rate limiting / abuse protection** on any of the public-facing
   routes (login attempts, the admin login, or the public leaderboard API).
8. **Realtime is used on `/team/[teamId]` but not `/judge/[teamId]`** — a
   judge's own scan screen doesn't currently need it (they're the one
   causing the changes), but if two judges' phones were ever both
   scanning for the same team, they wouldn't see each other's scans live
   without a manual refresh.
9. **The `service_role` key is a single point of trust** for `/admin` and
   `/leaderboard`. If that key ever leaked, it bypasses all RLS entirely.
   It's stored only as a Vercel server-side env var (never sent to the
   browser), which is correct practice, but worth knowing as the one key
   that matters most to protect.

## What I want from you

- Point out anything above that's a bad practice or a real risk for a
  live event with real people, not just a theoretical concern
- Suggest what's actually worth fixing before race day (19 Sept 2026) vs.
  what's fine to leave as a known limitation for a one-day internal tool
- Flag anything in the architecture itself (schema, RLS design, the
  fake-email auth trick, the polling-based leaderboard) that you'd have
  designed differently, and why
- Suggest anything missing entirely that a race-timing system like this
  usually needs, that isn't listed above
