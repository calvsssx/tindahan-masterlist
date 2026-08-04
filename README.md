# Tindahan Master List

A single-page inventory master list app (add / edit / delete items), synced across devices via Supabase, with sign-in required.

**The Supabase URL and key never reach the browser.** All Supabase calls (auth + data) happen inside Vercel Serverless Functions under `/api`, which hold the credentials as server-only environment variables. The browser only ever talks to your own `/api/*` endpoints and holds a single HttpOnly session cookie \u2014 it never sees a Supabase key or token it could read out of DevTools.

Trade-off: this means there's no direct-to-browser realtime push anymore (that would require shipping a key for the WebSocket handshake). Instead the app polls `/api/items` every ~8 seconds. For a two-phone household tool that's effectively instant and a reasonable price for keeping the key server-side only.

## 1. Set up Supabase (one-time, ~5 minutes)

1. Go to https://supabase.com/dashboard and create a free account/project.
2. Open **SQL Editor** \u2192 **New query**, paste in `supabase-schema.sql`, click **Run**. This creates the `items` table and Row Level Security policies requiring sign-in.
3. Open **Authentication \u2192 Providers \u2192 Email**, turn **off "Confirm email"** so accounts work immediately after signup (a private household tool doesn't need the extra email-confirmation step). Leave it on if you'd rather confirm once by email.
4. Open **Project Settings \u2192 API** and note down:
   - **Project URL** (e.g. `https://xxxxxxxx.supabase.co`)
   - **anon public** key

## 2. Push this to a git repo

```
cd tindahan-master-list
git init
git add .
git commit -m "Initial commit"
```

Create a repo on GitHub/GitLab/Bitbucket and push. `.env.local` is gitignored, so nothing sensitive gets committed.

## 3. Deploy to Vercel

1. Go to https://vercel.com/new and import the repo.
2. Before deploying, open **Project Settings \u2192 Environment Variables** and add:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. Deploy. Vercel installs `@supabase/supabase-js` automatically (it's a real dependency now, listed in `package.json`), serves `public/` as the static site, and deploys everything under `/api` as Serverless Functions.

Changing an env var in Vercel's dashboard requires a redeploy to take effect.

## 4. Local development

**Option A \u2014 no Vercel CLI needed (simplest):**

```
cp .env.example .env.local
# edit .env.local with your real SUPABASE_URL and SUPABASE_ANON_KEY
npm install
npm start
```

This runs `local-server.js`, a small plain-Node server that serves the frontend and re-implements just enough of Vercel's request/response helpers (`req.query`, `req.cookies`, `req.body`, `res.status()/json()`) for the exact same `/api/*.js` files to run unmodified. Open http://localhost:3000.

**Option B \u2014 using the Vercel CLI** (closer to how it behaves once deployed):

```
npm i -g vercel        # once, globally
vercel dev
```

`vercel dev` reads `.env.local` automatically (or pull real values from your Vercel project with `vercel env pull .env.local`) and serves both the static site and the `/api` functions together, usually at `http://localhost:3000`.

Either option works the same from the browser's point of view \u2014 use whichever is more convenient. `local-server.js` only exists for local development; it's not used when deployed to Vercel (Vercel runs each `/api/*.js` file as its own Serverless Function directly).

## 5. Create your account

1. Open the deployed site (or `localhost:3000` locally). Tap **Create an account**, fill in name/email/password.
2. If email confirmation is off, you're signed in immediately.
3. On the second phone, open the same link and **Sign in** with the same email/password.

Everyone signed in (any account) shares the same list \u2014 there's no per-user split.

## How auth works, briefly

- Sign in/up hit `/api/auth/signin` or `/api/auth/signup`, which talk to Supabase server-side and set a single HttpOnly cookie holding a refresh token. The browser can't read this cookie's value via JavaScript.
- Every protected `/api/*` call uses that cookie to get a fresh Supabase session server-side (via `refreshSession`), then makes the actual Supabase request using that user's own access token \u2014 so Row Level Security still applies exactly as if the user had signed in directly.
- `/api/auth/me` is how the page checks "am I already signed in?" on load, without ever holding a Supabase token client-side.
- Signing out just clears the cookie.

## Notes
- First load after setup seeds the table from the original spreadsheet \u2014 automatic, one-time, on whichever device loads it first.
- Edits sync within one save; other open devices pick them up on their next ~8-second poll (skipped while that device has an edit sheet open, so you don't get yanked out of what you're doing).
- If a request fails (network blip, expired session), the app shows a toast and, for an expired session, drops back to the sign-in screen.
- The reset button wipes and reseeds the whole table from the original list \u2014 same as before, just routed through `/api/items/reset` now.

## Project structure
```
tindahan-master-list/
\u251c\u2500 public/
\u2502  \u2514\u2500 index.html            the app \u2014 talks only to /api/*, never to Supabase directly
\u251c\u2500 api/
\u2502  \u251c\u2500 _lib/
\u2502  \u2502  \u251c\u2500 supabaseServer.js  server-only Supabase client (reads env vars)
\u2502  \u2502  \u251c\u2500 cookies.js         cookie serialization helper
\u2502  \u2502  \u251c\u2500 auth.js            session cookie + requireUser guard
\u2502  \u2502  \u251c\u2500 itemMapping.js     row \u2194 item shape conversion + seeding
\u2502  \u2502  \u2514\u2500 defaultItems.js    the original spreadsheet list (server-side only now)
\u2502  \u251c\u2500 auth/
\u2502  \u2502  \u251c\u2500 signup.js
\u2502  \u2502  \u251c\u2500 signin.js
\u2502  \u2502  \u251c\u2500 signout.js
\u2502  \u2502  \u2514\u2500 me.js              session check used on page load
\u2502  \u251c\u2500 items.js              GET list / POST upsert / DELETE by id
\u2502  \u2514\u2500 items/
\u2502     \u2514\u2500 reset.js           POST \u2014 wipe + reseed
\u251c\u2500 local-server.js          plain-Node local dev server (no Vercel CLI needed)
\u251c\u2500 package.json             lists @supabase/supabase-js as a real dependency
\u251c\u2500 vercel.json              serves public/ as static output; /api auto-detected
\u251c\u2500 .env.example             template \u2014 safe to commit
\u251c\u2500 .gitignore               keeps .env.local and node_modules out of git
\u2514\u2500 supabase-schema.sql      run once in Supabase's SQL editor
```
