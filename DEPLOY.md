# Deploying Mission to Vercel

This is the single highest-impact thing you can do for speed and for
letting other people use the app. A Vercel deploy gives you:

- **A real production build** — 5–10× faster than `npm run dev` for
  navigation and interactions. Most of the "lag when pressing buttons"
  you feel locally is dev-mode overhead and simply vanishes.
- **A real URL** (`https://your-app.vercel.app`) that works on any
  phone, anywhere — no localhost / IP address / firewall juggling.
- **Auto-deploy on push** — every `git push` to `main` redeploys.
- **Free tier** is plenty for a beta with friends.

You only have to do the click-through once. After that it's automatic.

---

## Before you start

You already have:
- ✅ A GitHub repo (`stephenmckeyes/llll`) with the code pushed.
- ✅ A Supabase project (the backend + database).

You'll need (have these tabs open):
- Your Supabase dashboard → **Project Settings → API**. Two values:
  - **Project URL** (looks like `https://abcdefgh.supabase.co`)
  - **anon / public key** (a long `eyJ...` string — the *anon* key,
    NOT the service_role secret).

---

## Step 1 — Create the Vercel project

1. Go to https://vercel.com and sign up / log in. **Use "Continue with
   GitHub"** so Vercel can see your repos.
2. Click **Add New… → Project**.
3. Find `llll` in the repo list and click **Import**.
4. Vercel auto-detects Next.js — leave the build settings at their
   defaults (Framework Preset: Next.js, Build Command: `next build`,
   etc.). **Don't deploy yet** — add the env vars first (next step).

## Step 2 — Add environment variables

Still on the import screen, expand **Environment Variables** and add
these two (copy the values from your Supabase API settings tab):

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | your Project URL (`https://...supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon/public key (`eyJ...`) |

That's all the app needs at runtime. (`DATABASE_URL` is only used by
the local migration tooling — it does NOT need to be on Vercel.)

Leave them applied to all environments (Production, Preview,
Development) — the default.

## Step 3 — Deploy

Click **Deploy**. Wait ~1–2 minutes. You'll get a URL like
`https://llll-xyz.vercel.app`. **Don't celebrate yet — auth won't work
until Step 4.**

## Step 4 — Point Supabase auth at the new URL (CRITICAL)

Supabase only allows logins/redirects from URLs you've whitelisted.
Until you do this, sign-in, sign-up, and email-confirmation links on
the deployed site will fail (they'll bounce to localhost or error).

In the Supabase dashboard:

1. Go to **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel URL:
   `https://llll-xyz.vercel.app`
3. Under **Redirect URLs**, click **Add URL** and add:
   - `https://llll-xyz.vercel.app/**`  (the `/**` wildcard covers every
     path — auth callbacks, email-confirm landing, etc.)
   - Keep `http://localhost:3000/**` too, so local dev still works.
4. Save.

## Step 5 — Verify

On your **phone** (or any device), open the Vercel URL and check:

- [ ] The signed-out landing page loads.
- [ ] You can sign in with your existing account.
- [ ] The dashboard loads and feels noticeably snappier than localhost.
- [ ] Marking something complete works.
- [ ] Settings → Sign out works, then sign back in.

If sign-in silently fails or redirects somewhere weird, re-check Step 4
(it's almost always the Redirect URLs).

---

## After deploy: the workflow

- **Every `git push` to `main` auto-deploys.** You'll get an email +
  the Vercel dashboard shows build status. No manual step.
- **Database migrations are still manual** — when a change adds a new
  migration file under `lib/db/migrations/`, paste its SQL into the
  Supabase SQL editor as before. Vercel deploys the *app code*; it does
  not run migrations. (This is why the app and DB can drift — always
  apply the migration before/with the deploy that needs it.)
- **Preview deploys**: pushing to a non-main branch gives you a
  separate preview URL — handy for testing risky changes without
  touching the live site.

## Optional niceties (later)

- **Custom domain**: Vercel → Project → Settings → Domains. Point a
  domain you own (or buy one through Vercel) at the app. Then update
  the Supabase Site URL + Redirect URLs to match.
- **PWA install**: on iPhone Safari, Share → Add to Home Screen turns
  the deployed site into an app-like icon that opens fullscreen. (We
  can add a proper web manifest + icons later to make this nicer.)

---

## Troubleshooting

- **"Invalid login credentials" or redirect to localhost on the
  deployed site** → Step 4. Site URL + Redirect URLs must include the
  Vercel domain.
- **Build fails on Vercel but works locally** → check the Vercel build
  log. Usually a missing env var (Step 2) or a TypeScript error that
  `next build` catches but `next dev` doesn't.
- **Blank page / "supabaseUrl is required"** → the
  `NEXT_PUBLIC_SUPABASE_*` env vars aren't set on Vercel, or were added
  after the deploy (env var changes require a redeploy: Vercel →
  Deployments → … → Redeploy).
- **Changes don't show up** → confirm the push reached `main` and the
  Vercel deploy succeeded (Deployments tab). Hard-refresh the browser.
