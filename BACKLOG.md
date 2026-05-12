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

## NEXT TURN: Edit-Activity / Edit-Rhythm as in-place modals (not new pages)

Per user spec: tapping "Edit activity" / "Edit rhythm" on a Day row should
swap the modal's content from details → edit form, without navigating
away (so you don't lose scroll position in the day list).

Build:
- `updateActivity` server action (mirror of `createActivity`, scoped to
  one row).
- A reusable `ActivityFormBody` component extracted from the existing
  create form, that accepts `initialValues`. Used in both /activities/new
  (create) and the new edit modal (edit).
- Activity-modal grows a `mode` state: `'details' | 'edit-activity' |
  'edit-rhythm'`. Buttons switch mode instead of navigating.
- Rhythm change branch: when the rhythm changes, ask "Apply to all
  future occurrences?" (modal confirm). Delete pending future instances
  for this activity and regenerate from the new rhythm + today's date.
  Past instances + their completions are never touched (design doc
  rule).
- Once the in-place editor lands, the `/activities/[id]/edit` placeholder
  page can be deleted.

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
- Real /activities/[id]/edit page with rhythm-change-future option.
- Reminders.
- Year view "scroll between years."

## Wording / UX reminders

- **"Drop and save"** label currently appears on the details-bar archive
  button. The user wants to revisit this wording (eventually replace with
  something more on-tone like "Set aside," "Park," "Retire," etc.).
- **Future-date complete warning** is currently a hard `window.confirm`
  every time. Eventually add a per-user setting:
  `profiles.confirm_future_complete bool default true`. When the user
  unchecks it in settings, the confirmation is suppressed.
- **Uncomplete from Month view** — green ✓ boxes are currently read-only.
  Add a `revertCompletion(instanceId)` server action and make green boxes
  click-to-revert (with `window.confirm("Mark this as not done?")`).

## Grid / Habit-Tracker view (asked for, not started)

A separate "GRID" / habit-tracker view on the dashboard:

- Far-left column: every recurring activity (one row per activity).
- Top row: dates across the chosen date range.
- Cells: filled or struck if the user completed the activity on that day,
  empty/red/grey if skipped or missed.
- Far-right column: success percentage for the row over the range.
- Range picker: default current week, jump to month / year / arbitrary
  start-end.
- Visual progress / accountability at a glance.

Implementation notes: query completion_instances joined to
activity_instances + activities for the range, group by activity + date,
roll up status. Color cells by activity tag (when tag colors exist).
Probably its own `?view=grid` entry on the home dashboard.

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
