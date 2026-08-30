# Fight or Flight — Race Timing

QR-based live timing for the Fight or Flight team event: 30 teams, 12 stations
each preceded by a 400m run, one judge following each team the whole way.

## How it works

- Each team already has a printed QR code (their team ID, e.g. `FF073001`).
- Each judge logs in with a **username + password** (no email involved — see
  "Judge & team logins" below) and sees only the teams assigned to them.
- On the judge's scan screen, there's one button: **Scan QR code**. The app
  works out on its own whether this scan is an "arrive" or "leave" for the
  current station, so there's nothing for the judge to select mid-race.
- Teams log in (also username + password) to watch their own live splits.
- You (the organizer) manage everything — team details, judge assignments —
  from `/admin`, gated by a single shared password.
- `/leaderboard` is a public, no-login spectator screen — put it on a
  projector or share the link, and it updates automatically every few
  seconds.

## 1. Supabase setup

Run these SQL files, in order, in the Supabase SQL editor (you've already
run most of this if you followed along step by step):

1. `sql/001_schema.sql` — creates all tables
2. `sql/002_rls_policies.sql` — locks every table down, then opens exactly
   the access judges/teams need
3. `sql/seed/001_teams.sql` — loads your 30 teams
4. `sql/004_scan_undo_policy.sql` — lets judges undo their own last scan

Then, in the Supabase dashboard:

- **Database → Replication**: enable Realtime on the `scans` table. This is
  what makes a team's results page update live as their judge scans, with no
  page refresh.

## 2. Judge & team logins (username + password, no email)

Supabase Auth is email-shaped under the hood, so usernames are converted to
a fake internal address before ever touching Supabase — nobody sees or types
anything email-like. The conversion is `username` → `username@judges.fightorflight`
(the domain is set by `NEXT_PUBLIC_AUTH_FAKE_DOMAIN` in your env vars).

To create a judge login:

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

- **Offline handling**: if a judge's phone loses signal mid-scan, the scan is
  saved on the phone and synced automatically once connectivity returns — no
  data is lost, no action needed from the judge. This doesn't replace your
  manual backup sheet as the ultimate fallback.
- **Undo last scan**: on the scan screen, for mis-scans.
- **Admin password**: `/admin` is gated by a single shared password
  (`ADMIN_PASSWORD` in your env vars) rather than a full user account — this
  is intentionally simple since only you'll use it. It's fine for a one-day
  private event tool, but don't reuse this password anywhere sensitive.

## What's not built yet

- CSV/spreadsheet export matching your original Race HQ format
- Station-side QR codes (currently the sequence 1→12 is assumed in order)

Happy to build any of these next.
