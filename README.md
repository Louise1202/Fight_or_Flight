# Fight or Flight — Race Timing

QR-based live timing for the Fight or Flight team event: 30 teams, 12 stations
each preceded by a 400m run, one judge following each team the whole way.

## Who sees what

There are four separate interfaces, each for a different person, all in the
same phone-friendly web app (no install needed — just a link):

| Who | URL they use | What they see |
|---|---|---|
| **A judge** | `/login`, then automatically sent to `/judge` | Their assigned teams, and a scan screen with one big "Confirm" button per team |
| **A team** | `/login`, then automatically sent to `/team/[their team]` | Their own live splits, current station, and final time once finished |
| **Spectators / a projector** | `/leaderboard` — no login | Every team's live status: finished (ranked), on course (with current station), and not yet started |
| **You (the organizer)** | `/admin` — single shared password | A "Start Heat" button for each heat, a live monitor of all 30 teams, the full teams table (editable), judge/team account creation, a printable QR code sheet, and an Excel export |

Judges and teams both log in at the same `/login` page with a **username +
password** — the app automatically figures out which of the two screens to
send them to, so there's nothing for them to choose.

- Each judge only ever sees their own assigned team's scan screen (never
  anyone else's), so there's no camera or QR scanning involved — just one
  big **Confirm** button. The app works out on its own whether this tap
  is an "arrive" or "leave" for the current station, so there's nothing
  for the judge to select mid-race — and the database itself
  double-checks every confirmation is actually the correct next one
  before accepting it.
- Printed team QR codes (`/admin` → Print QR codes) are still available
  for identification purposes (team cards, bib tags, etc.), but they're
  no longer required for the timing flow itself.
- **Nothing is timed until you start it.** Each heat's start time isn't a
  fixed value — it only becomes real the moment you press **"Start Heat N"**
  on `/admin`. The instant you do, every judge and team in that heat sees a
  live ticking race clock appear on their own phone automatically, with
  nothing for them to refresh or tap. Before that, judges see "Waiting for
  the admin to start" instead of a scan button, so nothing can get timed
  early by mistake.
- Because every team's clock runs from *their own* heat's real start time,
  a later heat's team overtaking an earlier heat's team on the course never
  causes a timing mix-up — each team's official time only ever depends on
  their own start and their own scans, never on who else is nearby.
- `/admin`'s **Live race monitor** is the "everything happening, right now"
  view: every team currently on course, who's judging them, their current
  station, live elapsed time, and how long since their last scan — with a
  colored dot (green/amber/red) if a team hasn't had a scan in a while, so
  you notice a stalled phone before anyone else does.

## 1. Supabase setup

Run these SQL files, in order, in the Supabase SQL editor (you've already
run most of this if you followed along step by step):

1. `sql/001_schema.sql` — creates all tables
2. `sql/002_rls_policies.sql` — locks every table down, then opens exactly
   the access judges/teams need
3. `sql/seed/001_teams.sql` — loads your 30 teams
4. `sql/004_scan_undo_policy.sql` — lets judges undo their own last scan
5. `sql/005_idempotent_scans.sql` — adds a unique `client_scan_id` so a
   retried offline scan can never be recorded twice
6. `sql/006_scan_validation_trigger.sql` — rejects any scan that doesn't
   match the team's actual next expected station/event, enforced by the
   database itself (not just the app's UI)
7. `sql/007_waves.sql` — creates the `waves` table (one row per heat) and
   seeds it with your 4 scheduled times, `actual_start` left blank until
   race day
8. `sql/008_heat_auto_close.sql` — adds `actual_end` to each heat and a
   trigger that automatically stamps it the moment every team in that
   heat has crossed the finish line
9. `sql/009_fix_divisions.sql` — fixes the seeded division labels
   (`Mens`/`Womans`) to `Men`/`Women`

Then, in the Supabase dashboard:

- **Database → Replication**: enable Realtime on both the `scans` table
  and the `waves` table. Realtime on `scans` is what makes a team's
  results page update live as their judge scans. Realtime on `waves` is
  what makes every judge's and team's phone start their clock the
  instant you press "Start Heat" on `/admin` — without it, they'd still
  work, just via a slower manual refresh instead of instantly.

## 2. Judge & team logins (username + password, no email)

Supabase Auth is email-shaped under the hood, so usernames are converted to
a fake internal address before ever touching Supabase — nobody sees or types
anything email-like. The conversion is `username` → `username@judges.fightorflight`
(the domain is set by `NEXT_PUBLIC_AUTH_FAKE_DOMAIN` in your env vars).

**Create these from `/admin` directly** — log in with your `ADMIN_PASSWORD`,
and you'll see two forms: "Create a judge login" and "Create a team login".
Fill in a name/team, a username, and a password, and it creates the actual
Supabase Auth account, links it to the right table, and (for judges)
assigns their teams — all in one step. No manual Supabase dashboard work
or SQL required.

The teams table on `/admin` also shows a "Viewer login" column so you can
see at a glance which teams still need one set up.

<details>
<summary>Manual fallback (only if the admin UI is ever unavailable)</summary>

1. Supabase → **Authentication → Users → Add user**
2. Email: `nicolene@judges.fightorflight` (i.e. their chosen username + your
   fake domain)
3. Password: whatever you assign them
4. Tick **Auto Confirm User**
5. Copy the generated UUID, then run:
   ```sql
   insert into judges (id, name) values ('<uuid>', 'Nicolene');
   insert into judge_team_assignments (judge_id, team_id) values
     ('<uuid>', 'FF073001');
   ```

Team logins work the same way, but insert into `team_viewers` instead:

```sql
insert into team_viewers (id, team_id) values ('<uuid>', 'FF073001');
```
</details>

Since judge assignments are still being finalized, this can happen any time
before race day — it doesn't block anything else.

## 3. Local development

```bash
npm install
cp .env.local.example .env.local   # fill in your real Supabase values
npm run dev
```

## 4. Deploy to Vercel

1. Push this project to your GitHub repo.
2. In Vercel: **Import Project** → select the repo.
3. Add the same environment variables from `.env.local.example` under
   **Settings → Environment Variables**.
4. Deploy. Every push to `main` redeploys automatically.

## Notes for race day

- **Starting a heat is reversible**: each "Start Heat N" button becomes an
  "Undo start (mis-click)" link once pressed, in case the wrong heat gets
  started or it's pressed too early. Undoing just clears the start time —
  no scans or results are affected.
- **Heats close themselves automatically** — the moment the last team in
  a heat crosses the finish line, that heat is marked finished with no
  action from you. **Important limitation**: this can only fire if every
  single team in the heat actually finishes. If a team DNFs, withdraws,
  or otherwise will never cross the line, that heat will sit "in
  progress" forever waiting for a team that isn't coming — use the
  **"End heat"** button in that case to close it manually. There's also
  a "Reopen heat" link if a heat gets closed by mistake.
- **QR codes**: print the full set any time from `/admin` → **Print QR
  codes**. It's generated live from your current team list, so if you add
  or rename a team, just reprint that page — nothing to regenerate by hand.
- **Offline handling**: if a judge's phone loses signal mid-scan, the scan is
  saved on the phone and synced automatically once connectivity returns — no
  data is lost, no action needed from the judge. This doesn't replace your
  manual backup sheet as the ultimate fallback.
- **Undo last scan**: on the scan screen, for mis-scans.
- **Duplicate-proof scans**: every scan carries a unique ID generated on
  the judge's phone, so if an offline retry ever resends a scan that
  actually already made it through, the database silently ignores the
  duplicate rather than recording the station twice.
- **Wrong-scan protection**: the database itself checks that any incoming
  scan matches the team's real next expected station/event, and rejects
  it otherwise — this isn't just a UI nicety, it holds even if a scan
  somehow bypassed the normal screen.
- **Excel export**: the "Export to Excel" button on `/admin` downloads a
  workbook with Results, Teams, Scans, and Penalties sheets, generated
  live from the database — a real backup file, not just what's on screen.
- **Admin password**: `/admin` is gated by a single shared password
  (`ADMIN_PASSWORD` in your env vars) rather than a full user account — this
  is intentionally simple since only you'll use it. It's fine for a one-day
  private event tool, but don't reuse this password anywhere sensitive.

## What's not built yet
- Station-side QR codes (currently the sequence 1→12 is assumed in order)

Happy to build any of these next.
