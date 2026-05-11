# Mission — Backlog

Captured ideas and follow-ups for future sessions. Not in priority order.
Imported by `CLAUDE.md` so every new Claude Code session sees this on
startup.

## Pending features (asked for, deferred on purpose)

### Onboarding flow on first sign-in
First-time users should land in a short questionnaire before the
dashboard, not directly on an empty today view.

- **Timezone** (required) — `profiles.timezone` currently defaults to
  `'UTC'` via the `handle_new_auth_user` trigger (migration 0001).
  Onboarding writes the user's actual TZ + flips a new
  `onboarded_at timestamptz` column we'd add.
- Could also collect: display name, default notification channels,
  default visibility for new activities, weekly check-in cadence.
- Routing rule: if `auth.uid()`'s profile has `onboarded_at IS NULL`,
  every page should redirect to `/onboarding` (middleware-friendly).

### Time format toggle (12h vs 24h)
Today the app formats times via the browser's locale
(`Date#toLocaleTimeString`), so a US user sees "8:00 AM" and a
German user sees "08:00." A user override:

- Add `profiles.time_format text` with values `'auto' | '12h' | '24h'`,
  default `'auto'`.
- Centralize all time rendering through a single helper
  (`lib/ui/format-time.ts`) so a one-line change cascades.
- Setting lives on the settings page (which itself doesn't exist yet —
  ships with onboarding).

## Banner-style calendar rendering (asked for, partial)

Activities should appear as **named banners** on calendar surfaces, not
just counts. Status now: the create-activity preview shows each
scheduled day with the activity name banner-inside-the-cell; the home
Week view shows full banners per day; Month view still uses counts
(small cells make multi-banner stacking tricky).

Future direction (per user spec):
- Month view: show 1–2 activity-name banners per cell + `(+N more)`
  overflow badge when more apply that day.
- Year view: density heatmap; click a month → zoom.
- **Tag-grouped overflow**: instead of just `(+5)`, say `(+5 meetings)`
  / `(+3 fitness)` so the overflow is informative. Implementation:
  group remaining banners by their first tag; show top N tag-counts.
- Banners colored by first tag (when tags become first-class).

## Phase 2c+ (planned but not started)

- **Multi-Daily as a modifier** combinable with other rhythms ("every 3 days,
  twice a day"). Currently mutually exclusive in the form.
- **Reminders** — per-activity, multiple per activity, configurable time
  before (minutes / hours / days / weeks), per-channel (in-app first,
  then email, then SMS, then push).
- **Notification delivery** — cron / scheduled function fires reminders.
  Start with in-app + email via Resend.
- **All-activities management page** — list, edit, archive, abandon
  (with reason). Currently no way to revisit an activity once created.
- **Per-activity history view** — completions over time, streak, totals.
- **Settings page** — TZ override, time format, default visibility,
  notification preferences, password / email change.
- **Activity-level visibility + friends + clans** — schema field is in
  place from day 1; UI/sharing layer not built.
- **Skill aggregation** — promote frequently-used tags into "skills"
  with progression (the original RuneScape-inspired vision).
- **Deploy to Vercel** — get a real URL so phone PWA install works
  outside home wifi.

## Known quirks / cleanup

- Drizzle migration snapshots are out of sync with `schema.ts` since
  the 0002 custom unification migration; `drizzle-kit generate` would
  prompt to resolve renames. Future migrations should stay `--custom`
  until we re-sync.
- "Today" date math uses server UTC, not the user's profile timezone.
  Travel quirks acknowledged in the design doc; revisit when TZ
  settings ship.
- `vite-tsconfig-paths` plugin shows a deprecation hint at every test
  run; Vitest 4 supports it natively via `resolve.tsconfigPaths: true`.
  Swap when convenient.
