# Mission — Backlog

Captured ideas and follow-ups for future sessions. Not in priority order.
Imported by `CLAUDE.md` so every new Claude Code session sees this on
startup.

## Pending features (asked for, deferred on purpose)

### Tags as first-class entities (color-coded, dropdown picker)

Asked for. Today `activities.default_skill_tags` is a free-text
`text[]` column. User wants:

- **Tag dropdown** in the create / edit activity form (not a free
  text input), with the user's existing tags listed + a "+ New tag"
  option that opens an inline name + color editor.
- **Color per tag**, picked from a predefined palette (probably
  ~12 colors — emerald, sky, amber, red, violet, etc.) — keeps
  rendering simple and the visual identity recognizable across
  views.
- **Display per view:**
  - **Day**: full color chips on the row banner (name on the chip).
  - **Week**: small color dots prepended to each banner — one dot
    per tag.
  - **Month**: tiny color dots at the bottom of each cell (max ~3
    visible before "+N").
  - **Year**: nothing (cells are too small to read color hints).
- **Grid Type column**: per-row "Tags" link that opens a small popup
  listing the activity's tags as chips. Editing still goes through
  the existing Edit-Activity flow (which we'd update to use the new
  dropdown).

Implementation sketch:
- New `tags` table: `id uuid pk, user_id uuid fk, name text not null,
  color text not null, created_at timestamptz default now(),
  unique (user_id, name)`.
- Keep `activities.default_skill_tags` as `text[]` (names) for back-
  compat — the new `tags` table is just a (per-user) name→color
  lookup. Activities don't need to change shape.
- Tag colors are stored as a palette key ("emerald" / "amber" / ...)
  rather than a raw hex, so we can map to Tailwind classes for both
  light + dark modes.
- Server actions: `createTag(name, color)`, `deleteTag(id)`. List
  query for the dropdown is cheap (per-user, usually <50).
- Migration of existing free-text tag values: on first form open
  after this lands, treat any `default_skill_tags[]` value not in
  the user's tags table as needing creation (auto-create with a
  random palette color, user can re-color later).

### Multi-time reminders verification

Asked for. After the multi-time refactor (every rhythm can now have
multiple `scheduled_times[]`), verify that **reminders fire for
each time of day**, not just the first one. The reminders table
+ delivery pipeline isn't built yet (Phase 2c+), but when it ships,
the per-time fan-out has to be in the reminder-schedule generator,
not the activity model. Easy to forget — leaving this here as a
specific check item.

### Settings page / timezone change

Asked for. Today we display the user's browser-detected timezone in
the page header (`TimeChip` component) but there's no way to change
it. Plan:

- **Settings page** at `/settings` collects:
  - Timezone override (defaults to browser-detected, falls back to
    profile column on server).
  - 12h vs 24h time format toggle (paired entry from the existing
    backlog item).
  - Default activity visibility / notification preferences (later).
- **`profiles.timezone`** already exists from migration 0001 (defaults
  to `'UTC'`); the onboarding-flow item plans to populate it.
- Change should NOT be in the main UI — it's a "set once" decision
  that shouldn't be hit by accident.

### Alternate Grid-view visualizations

Today the Grid view renders activity history as colored cells (a
heatmap). The user wants additional visualization options so the
same data can be looked at multiple ways. Picker would live in the
grid's sub-tabs or a per-view dropdown.

- **Chain** — for each activity, draw the days as connected links of
  a chain going day to day. A missed day is a visible **break** in
  the chain (the link before/after is rendered jagged or with a gap).
  Reinforces the "don't break the chain" mental model viscerally.
- **River with dams** — each activity is a flowing river. Days
  completed are smooth water; missed days are **dam** icons that
  block flow. Visually communicates lost momentum.
- **Sparkline / line graph** — for activities with quantitative
  metrics (when those land), plot the value over time, not just
  presence/absence.
- **Calendar-overlay** — instead of per-activity rows, render a
  single calendar with stacked color dots per day (one dot per
  completed activity that day).

All variants would read from the same underlying
`activity_instances` data — purely rendering changes. Probably
keep the current Heatmap as the default and add `?viz=chain` /
`?viz=river` URL params (the sub-tab pattern already in place).

### AI-friendly data export for trend analysis

(Asked for: "incorporate ways to mass-pull information that someone
could put into AI to analyze trends of when/why they might mess up
on their goals.") Plan:

- A **Settings → Export** button that bundles the user's recent
  history (e.g., last 6 / 12 months) into a single JSON/CSV file:
  - Activities with name, rhythm, notes, tags, start/end dates.
  - Every `activity_instance` with status, scheduled_for, and any
    linked completions (occurred_at, effort_rating, note).
  - Daily / weekly / monthly rollups (completion rate per activity,
    per tag) — useful summary statistics so the AI doesn't have to
    rederive them from raw rows.
- Output **redacts emails / private IDs** but keeps activity names
  (which the user already wrote). A toggle could optionally
  hash names for sharing.
- Suggested companion: a **markdown prompt template** the user can
  paste alongside the export — e.g., "Look at this productivity
  history. On what weekdays / time-of-day do I most often skip my
  activities? Which two activities seem to interfere with each
  other (correlated misses)? Which notes hint at common blockers?
  Surface trends I might not see myself."
- Out of scope for v1: API-style scheduled pushes, direct LLM
  integration. Manual export → paste into the user's AI of choice
  is the explicit shape.



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

## Grid view follow-ups

Grid view shipped with week / month / total ranges, with cells now
opening the ActivityModal in place, singles filtered out and surfaced
as a count banner, and a per-view "Incomplete (N)" jump chip. Still
to do:

- **Group rows by activity tag** — currently flat alphabetical. Once
  tags become first-class (skills layer), the grid should group rows
  by primary tag with a small tag header per group, so the user
  doesn't stare at a wall of unrelated activities side by side. Likely
  also: collapse/expand per group, and a "no-tag" bucket at the
  bottom.
- **Custom range picker** — start/end date inputs for arbitrary
  windows.
- **Row sort** — currently alphabetical inside each group; add
  toggles for "lowest success %" (where am I slipping) and "most
  active this period."
- **Color cells by activity tag** (once tag colors exist).
- **Quick-complete from grid cell** — clicking an overdue/scheduled
  cell currently opens the full modal. A small popover with just
  Complete / Missed / Open buttons would be even faster for the
  "fix that one cell" workflow.
- **Frequency rhythms ("3× per week")** currently get one cell per
  anchor day. Consider showing "2/3 done" per period instead — would
  pair well with the tag-grouping above (you'd see weekly tag totals
  alongside the daily-rhythm rows).
- **Year / multi-year range** — 365+-day grid is unreadable at normal
  cell sizes. Either compress cells (heatmap-style, no glyphs) or a
  separate "summary by week" layout (1 column per week, cell = "X of
  Y done" that week). The Total tab covers the "give me one number
  per activity" use case today.

## Calendar export — subscribe to Mission from iPhone/Android/Google/Outlook

(Asked for: "Eventually, let's add functionality to link our calendar
with other calendars.") Plan:

- Expose a per-user **read-only ICS feed** at
  `/api/calendar/:userToken.ics`. The token is a random per-user secret
  stored on `profiles.ics_token`; the user can rotate it from settings
  to revoke old subscriptions. The token must NOT be the user id.
- The feed emits a `VEVENT` per scheduled `activity_instance` in a
  rolling window (e.g., -30 days .. +180 days) and includes a stable
  `UID` of `instance-<uuid>@mission` so calendar apps deduplicate
  correctly on resync.
- DTSTART picks the first entry from `scheduled_times` if present;
  otherwise an all-day event (`DTSTART;VALUE=DATE:`).
- Each event's `LAST-MODIFIED` reflects the activity's `updated_at`
  so edits propagate on the next sync.
- Subscribe URLs the user copies into their calendar app:
  - iOS: Settings → Calendar → Accounts → Add → Other → Subscribed
    Calendar (or open `webcal://...` link from Mail).
  - Google Calendar: "Other calendars" → "From URL".
  - Outlook: Add calendar → Subscribe from web.
  - Android: depends on the calendar app; most modern ones consume the
    same URL via Google Calendar sync.
- Done as a follow-up phase; doesn't block dashboard work.

Two-way sync (Mission ↔ Google Calendar via OAuth) is a much bigger
piece (token refresh, change-detection, conflict resolution) and is
explicitly out of scope for this read-only ICS phase.

## Pending mobile follow-ups (post Phase 2c)

The web layout is significantly better than iPhone Safari per user
testing. Audit and polish for mobile:

- Touch-target sizes (44×44 minimum for everything tappable). Many
  buttons currently smaller.
- Modal should slide up from the bottom on phones (it already does
  with `items-end sm:items-center`) — verify it's actually usable, not
  cut off behind the address bar. Test with `100svh` everywhere a
  viewport-height is used.
- Day-list scroll container's `max-h-[68svh]` might fight the mobile
  keyboard; test with the date input focused.
- Activity form: the multi-daily times rows likely wrap awkwardly;
  Schedule grid-cols-2 might be cramped on small phones.
- Week view's 7-column banners are illegible on phones — consider
  collapsing to a horizontal-scroll list on narrow viewports.
- Year view's 3-up mini-month grid is probably tiny; switch to 2-up
  or 1-up on `sm:` breakpoint.
- Add a hamburger or bottom-tab nav on mobile (currently header
  buttons wrap onto two lines).
- `text-[10px]` and `text-[9px]` font sizes might be unreadable on
  high-DPI phones; bump or rely on `text-xs` minimum.

Also still pending from prior rounds (defer until mobile polish):
- Reminders.
- Year view "scroll between years."

## Wording / UX reminders

- **Future-date complete warning** is currently a hard `window.confirm`
  every time. Eventually add a per-user setting:
  `profiles.confirm_future_complete bool default true`. When the user
  unchecks it in settings, the confirmation is suppressed.
- **Uncomplete from Month view** — green ✓ boxes are currently read-only.
  Add a `revertCompletion(instanceId)` server action and make green boxes
  click-to-revert (with `window.confirm("Mark this as not done?")`).

## Architectural: projection-model recurrence (defer until scale demands it)

Today every occurrence of every recurring activity is *materialized* —
a real row in `activity_instances`. We picked this because each
occurrence carries its own state (pending / completed / missed,
X-of-Y progress, FK joins from `completion_instances`), and simple
SQL joins beat projecting-at-query-time for the dashboard views.

The cost: indefinite rhythms have to be materialized to *some*
horizon. We currently top up to ~1 year ahead via
`ensureInstancesBackfilled` so "forever" rhythms feel forever as the
user navigates. At 10 active daily activities, 1 year = ~3,650 rows
per user; trivial.

The "right" answer at larger scale is a **projection model**, the
same shape iPhone Calendar / Google Calendar use:
- Store the recurrence RULE only on `activities`.
- At view time, expand the rule against the visible window and join
  against a small `instance_overrides` table that only has rows for
  occurrences whose state diverged from default (completed, missed,
  user-edited time, etc.).
- Mutations that touch an occurrence (complete / miss / progress)
  INSERT into `instance_overrides` lazily.

Tradeoff: query-time projection is more code than a simple `WHERE
scheduled_for BETWEEN x AND y`. The 1-year materialization gives us
~95% of the UX win at ~5% of the engineering cost. Revisit when
either (a) per-user row counts cross a few hundred thousand or (b)
backfill latency becomes user-visible.

## Permanent-delete from Archived only

(Per user spec.) Active activities can only be archived (soft-delete).
Permanent deletion is a deliberate two-step action that requires the user
to navigate to the Archived section and confirm. The `deleteActivity`
server action exists for this; UI is wired in the All-activities page's
Archived section only.

## Year view "scroll between years" (asked for, partial)

Initial Year view renders the current year only with prev/next arrows.
The user mentioned wanting to scroll up/down to other years (à la iPhone
Calendar's vertical-scrolling year layout). Add as a follow-up: render
3-5 years stacked, lazy-load more as the user scrolls.

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
