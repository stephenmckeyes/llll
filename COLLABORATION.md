# Working on Mission from two machines / two Claude accounts

This repo can be developed from more than one computer (and more than one
Claude Code account) at once. Everything below keeps the two in sync without
stepping on each other.

## 1. What the two sides must share

- **The GitHub repo** — `https://github.com/stephenmckeyes/llll.git`. Both
  machines `git clone` it. Code syncs through GitHub (push/pull), never by
  copying files around.
- **The same Supabase project** — both point `DATABASE_URL` (and the
  `NEXT_PUBLIC_SUPABASE_*` keys) at the *same* project, so the app and the
  data are identical. (A second, separate Supabase project is only for an
  isolated sandbox — not for shared development.)
- **`.env.local`** — holds the Supabase keys + `DATABASE_URL`. It is
  **gitignored and never committed**. Copy `.env.example` → `.env.local` on the
  new machine and paste the real values. Share those values through a private
  channel (password manager / direct message), not the repo.

Everything else (conventions, backlog, architecture) is already in the repo and
loads automatically for any Claude Code session: `CLAUDE.md` imports `AGENTS.md`
+ `BACKLOG.md`.

## 2. One-time setup on the second machine

```bash
git clone https://github.com/stephenmckeyes/llll.git
cd llll
npm install
cp .env.example .env.local      # then paste the real Supabase values in
npm run dev                     # http://localhost:3000
```

## 3. Git workflow (avoid clobbering each other)

Both sessions commit to `main` by default. To keep that safe:

- **Always pull before you start and before you push:**
  ```bash
  git pull --rebase origin main
  # …work…
  git push origin main
  ```
- If a push is rejected ("fetch first"), someone else pushed. Just
  `git pull --rebase origin main`, resolve any conflicts, and push again.
- **Safer option — one branch per task + PR:** if the two of you often touch
  the same files, work on a branch and open a pull request instead of pushing
  straight to `main`:
  ```bash
  git checkout -b feature/short-name
  git push -u origin feature/short-name      # then open a PR on GitHub
  ```
  Merge via GitHub, then both sides `git pull` main. This gives you review +
  a clean history and makes conflicts obvious before they land.
- **Coordinate big refactors.** `app/page.tsx`, `app/_components/day-list.tsx`,
  and `activity-form-fields.tsx` are large shared files — if both sessions edit
  one at the same time you'll get merge conflicts. Divide work by area when you
  can.

## 4. Database migrations — now automatic (no more dashboard copy-paste)

Migrations are hand-written SQL in `lib/db/migrations/00NN_name.sql`. Apply them
with the runner instead of pasting into the Supabase SQL editor:

```bash
npm run db:apply            # runs every migration not yet applied
```

The runner records what it has applied in a `public._applied_migrations` table
**inside the database**, so because both machines share one Supabase project,
whoever applies a migration first, the other machine automatically sees it as
done and skips it.

**One-time baseline (because the DB already has migrations applied by hand).**
Tell the runner the last migration number you've already applied in Supabase so
it doesn't try to re-run them:

```bash
# e.g. if 0082 was the last one applied by hand:
npm run db:apply -- --baseline-to=0082
# then apply anything newer (0083+) for real:
npm run db:apply
```

If the DB already has **every** current migration, use `npm run db:apply --
--baseline` once instead. A brand-new empty database needs no baseline — just
`npm run db:apply` plays everything from `0001`.

**Writing a new migration** (either machine):
1. Add `lib/db/migrations/00NN_description.sql` (next number in sequence).
   Write it idempotently where practical (`IF NOT EXISTS`, `DROP POLICY IF
   EXISTS`, `CREATE OR REPLACE`), and end schema-changing ones with
   `NOTIFY pgrst, 'reload schema';` so PostgREST picks up the new columns.
2. `npm run db:apply` to apply it to the shared DB.
3. Commit the `.sql` file and push. The other machine pulls, and its own
   `npm run db:apply` is a no-op (the shared `_applied_migrations` table already
   shows it applied).

> The old `npm run db:migrate` (drizzle-kit) is **not** used — the Drizzle
> snapshots are intentionally out of sync (see BACKLOG "Known quirks"). Use
> `npm run db:apply`.

## 5. Conventions both sides must follow

These live in `AGENTS.md` / `CLAUDE.md` and apply to every contributor:

- **This is a modified Next.js** (`AGENTS.md`): read the relevant guide under
  `node_modules/next/dist/docs/` before writing framework code — APIs may differ
  from what you remember.
- **Friend-view parity standing rule** (`AGENTS.md`): any change to the personal
  views (dashboard, Total view, shared building blocks) must be mirrored to the
  read-only friend views at `app/friends/[friendId]/` — except editability. If
  porting doesn't make sense, stop and ask.
- **`"use server"` files may only export async functions.** Put pure helpers /
  constants in a non-server module (e.g. `lib/domain/*`) — `tsc` won't catch
  this, but the runtime build breaks.
- **Commit trailer:** end commit messages with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Backlog is the shared roadmap:** capture follow-ups in `BACKLOG.md` so the
  other session sees them on startup.

## 6. Note on per-account memory

Each Claude Code account keeps its **own** private memory (deploy-to-production
preference, "assume migrations applied", etc.) — that does **not** travel
through the repo. The onboarding brief (paste it into the new session once)
covers those so both accounts behave the same. See the brief your teammate
shares, or ask for it.
