# ERROR-404 — Debugging competition platform

React + TypeScript + Vite frontend (Supabase backend) for an organizer-led Python / JavaScript debugging event.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in your two Supabase values
npm run dev
```

## Deploy to Vercel

1. Set up Supabase first (see [supabase/README.md](./supabase/README.md)) and run `supabase/schema.sql`, then `supabase/sync_upgrade.sql` (this is what makes the organizer and participant pages share one live state).
2. Push this folder to a GitHub/GitLab repo (`.env.local` is git-ignored; never commit keys).
3. In Vercel: **Add New → Project → Import** the repo. Vercel detects Vite automatically (settings are also in `vercel.json`).
4. Under **Settings → Environment Variables**, add for Production (and Preview if you want):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Click **Deploy**. Vite reads these variables at build time, so after changing them you must **Redeploy**.
6. In Supabase: **Authentication → URL Configuration** → set **Site URL** to your Vercel URL (e.g. `https://error-404.vercel.app`) and add it (plus `https://*-yourteam.vercel.app` for previews) to **Redirect URLs**. Organizer sign-in will misbehave if this is skipped.

CLI alternative:

```bash
npm i -g vercel
vercel            # preview deploy
vercel --prod     # production deploy
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
```

Only the Supabase URL and anon/publishable key belong in frontend variables. Never expose a service-role key. Code execution and score calculation require a separate trusted sandbox/backend; the browser must not decide accepted submissions or award points.

## Build

```bash
npm run build   # outputs to dist/
```

## Organizer privacy

- The organizer dashboard is **not linked anywhere**. Open it at `https://YOUR-SITE/#organizer`; it shows a login screen and only opens for accounts on the `organizers` allow-list.
- Setup (once): in Supabase **Authentication → Users** create the organizer account(s), run `supabase/organizer_lockdown.sql`, then run the commented `insert into public.organizers ...` line with your email.
- In Supabase **Authentication → Sign In / Providers**, turn **off "Allow new users to sign up"** so nobody else can create an account.
- Without Supabase configured, the dashboard stays locked (there is no demo bypass).

## How the live sync works

- All event state (PIN, status, current question, which **page** participants see, timer deadline, participants, answers, scores) lives in Supabase. Nothing important is kept in the browser, so any phone or laptop that opens the link sees the same thing.
- **Organizer** (`/#organizer`): creates the event and chooses its **PIN** (or generates one), enrolls individuals/teams, starts / pauses / ends the event, picks the page participants see (Waiting room · Question · Leaderboard), sends or **skips** to any question, reviews submissions and awards points.
- **Participants** (`/#join` or `/#join/123456`): enter the PIN and a name. If the organizer pre-enrolled that exact name they claim that entry. Their screen follows the organizer within ~2 seconds; the timer is based on the server clock, so every device agrees.
- Share the join link from **Overview → Share with participants** (the PIN is pre-filled).
- A name can only be claimed by one device. If someone needs to switch devices, use the **Release** button next to them in **Participants**.
- The leaderboard stays hidden from participants until the organizer reveals it (or the event ends).
