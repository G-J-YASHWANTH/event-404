# ERROR-404 — Debugging competition platform

React + TypeScript + Vite frontend with Supabase authentication/database integration.

## Deploy to Netlify

1. Push the contents of this `error-404` folder to your Git repository.
2. In Netlify, choose **Add new site → Import an existing project** and select the repository.
3. Set the site base directory to `error-404` only if this folder is inside a larger repository. If this folder is the repository root, leave the base directory blank.
4. Netlify should read `netlify.toml` automatically. The build settings are:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Node version: `20`
5. In **Site configuration → Environment variables**, add these exact variable names for the Production deploy context (and Preview if required):
   - `VITE_SUPABASE_URL` — your Supabase Project URL
   - `VITE_SUPABASE_ANON_KEY` — your Supabase publishable key or legacy `anon` key
6. Trigger a new deploy after adding/changing variables. Vite embeds `VITE_` variables at build time.
7. In Supabase, open **Authentication → URL Configuration**:
   - Set **Site URL** to your deployed Netlify URL.
   - Add the deployed URL to **Redirect URLs**.
8. Open the deployed URL and test organizer sign-in.

The `netlify.toml` includes the Vite build/publish settings, a single-page-app fallback, and basic security headers.

## Local development

```bash
npm install
cp .env.example .env.local
# Edit .env.local and enter your real Supabase Project URL and publishable/anon key.
npm run dev
```

Build locally with:

```bash
npm run build
```

The production build is written to `dist/`.

## Required Supabase setup

A successful frontend deployment does not automatically configure the Supabase database.

1. In Supabase, run `supabase/schema.sql` in the SQL Editor if the schema has not already been applied.
2. Create the organizer account in **Authentication → Users**.
3. Review and then run `supabase/organizer_lockdown.sql` after the schema is in place. This creates the `public.organizers` allow-list and `public.is_organizer()` function, and adds a restrictive policy to `public.events`.
4. Add the existing organizer's Auth user to the allow-list by running the final insert statement in that SQL file after replacing `YOUR_ORGANIZER_EMAIL` with the organizer's exact email:
   ```sql
   insert into public.organizers(user_id, email)
   select id, email
   from auth.users
   where email = 'YOUR_ORGANIZER_EMAIL';
   ```
5. Confirm that exactly the intended organizer account is present in `public.organizers`.

Do not blindly run database scripts against a production project. Review the existing schema and policies first, and coordinate with the project owner before applying security-policy changes.

## Environment variable and key safety

- Only the Supabase Project URL and publishable/legacy `anon` key belong in this browser app.
- Never put a Supabase `service_role` key or secret key in a `VITE_` variable, frontend source, or committed file.
- `.env.local` is ignored by Git. Do not commit real credentials.
- `.env.example` contains placeholders only; replace them locally in `.env.local` or configure the real values in Netlify's environment-variable settings.

## Important production note

The current project UI contains demo/local-state behavior for parts of the competition flow. A successful Netlify deployment and organizer login do not by themselves mean event creation, submissions, evaluation, or scoring are fully connected to a trusted production backend. Review those workflows before running a real competition. Score evaluation must happen on a trusted server, not in the browser.
