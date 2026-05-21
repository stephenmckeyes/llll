# Mission — Backlog

Captured ideas and follow-ups for future sessions. Not in priority order.
Imported by `CLAUDE.md` so every new Claude Code session sees this on
startup.

## Pending features (asked for, deferred on purpose)

### Multi-time reminders verification

Asked for. After the multi-time refactor (every rhythm can now have
multiple `scheduled_times[]`), verify that **reminders fire for
each time of day**, not just the first one. The reminders table
+ delivery pipeline isn't built yet (Phase 2c+), but when it ships,
the per-time fan-out has to be in the reminder-schedule generator,
not the activity model. Easy to forget — leaving this here as a
specific check item.

### Settings page — additions

/settings was restructured into per-section sub-pages (Account /
Timezone / Appearance / Data + sign-out at bottom of the index).
Future additions:

- **2FA enrollment** — Supabase exposes MFA APIs (`auth.mfa.enroll
  / challenge / verify`) but the enrollment flow + recovery-code
  display need their own UI. Listed as a stub on /settings/account.
- **Current-password reauthentication** before password change.
  Today supabase.auth.updateUser({ password }) lets the user
  change without re-verifying — fine for v1, not great if the
  user shares a device.
- **12h vs 24h time format toggle** — see item below.
- **Default activity visibility / notification preferences** —
  later, after reminders ship.

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

## Banner-style calendar rendering (year view still pending)

Day, Week, and Month views now render real activity-name banners
colored by first tag. Month view collapses overflow into "+N tag ·
+M tag" lines grouped by first tag. Still pending:

- **Year view**: density heatmap; click a month → zoom. Cells are
  too small for name banners, so the design needs a different
  approach (dot per activity, or per-month aggregate).

## Grid view follow-ups

Grid view shipped with Week / Month / Total / Custom ranges, column-
header click-to-sort, in-place ActivityModal opens, an inline tag
filter, and a per-view "Unlabeled (N)" jump chip. Custom range
re-uses the Total heatmap layout and shifts by window-width on prev/
next. Still to do:

- **Group rows by activity tag** — currently flat alphabetical. The
  grid should group rows by primary tag with a small tag header per
  group, so the user doesn't stare at a wall of unrelated activities
  side by side. Likely also: collapse/expand per group, and a
  "no-tag" bucket at the bottom.
- **Color cells by activity tag** (a soft tint, additive on top of
  the status color).
- **Quick-complete from grid cell** — clicking an overdue/scheduled
  cell currently opens the full modal. A small popover with just
  Complete / Missed / Open buttons would be even faster for the
  "fix that one cell" workflow.
- **Frequency rhythms ("3× per week")** currently get one cell per
  anchor day. Consider showing "2/3 done" per period instead — would
  pair well with the tag-grouping above (you'd see weekly tag totals
  alongside the daily-rhythm rows).
- **Year / multi-year range** — Total scales but a 5-year heatmap
  has very small cells. Consider a "summary by week" layout option
  (1 column per week, cell = "X of Y done" that week) as a
  visualization alternative.

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
  Start with in-app + email via Resend. When this ships, the per-time
  fan-out (see "Multi-time reminders verification" above) must be in
  the schedule generator, not the activity model.
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
