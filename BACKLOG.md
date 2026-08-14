# Mission — Backlog

Captured ideas and follow-ups for future sessions. Not in priority order.
Imported by `CLAUDE.md` so every new Claude Code session sees this on
startup.

## Calendar unification (in progress)

Goal (per user): personal, friend, and community calendars share ONE base
(rendering + data shape); each surface layers its own permissions/functions
on top; the security boundary stays in the DB (RLS + SECURITY DEFINER RPCs)
and data is fetched server-side per view (best for privacy + performance).
- ✅ Foundation: `lib/domain/calendar-view.ts` — canonical
  CalendarActivityView / CalendarOccurrenceView / CalendarCapabilities.
- ✅ Week: shared `app/_components/week-banner.tsx` (WeekBannerPill) now
  used by BOTH the personal dashboard Week (page.tsx) and the friend/
  community Week (FriendCalendar). Note: personal Week now shows missed
  occurrences in red (was dark) — intentional consistency.
- ✅ Month: cell pill already shared (MonthCell / MonthBannerPill) across
  personal MonthList + friend/community MonthGrid.
- ✅ Year: unified on the RICH mini-month design (per user). Shared
  `app/_components/year-mini-months.tsx` (YearMiniMonths) now renders the
  personal Year (YearList, monthHref → /?view=month) AND the friend/
  community Year (FriendCalendar YearGrid, onMonthClick → Month sub-view).
  Community loads full-year per-day counts via `getCommunityYearCounts`
  (FriendCalendar's optional `loadYearCounts` prop); the friend view falls
  back to computing from its loaded instance window (data-limited — a
  friend full-year loader is a later nicety). Old density-heatmap Year
  deleted. Verified live: personal + community Year render the shared grid.
- ✅ Day: unified. Added an additive `collective` mode to InstanceRow (and
  threaded DayList → DaySection → InstanceRow + TimelineDayBody, plus
  FriendCalendar). Presence of `collective` handlers switches a row to
  inline binary Complete/Missed wired to setCommunityInstanceStatus; the
  personal path (default) and friend read-only path are untouched. The
  community Day now has inline Complete/Missed (verified live: completing
  Fri moved it to Completed/Missed (1); Sat stayed pending). Exported
  `CollectiveHandlers` from instance-row as the shared type.
  - Note: community completion goes through a server action, so Next.js
    auto-revalidates the community page — the completed occurrence moves
    into the Completed/Missed dropdown immediately (better than mark-in-
    place-only).
  - Pre-existing dev-only warning (day/month/year pre-hydration scroll
    `<script>` causes a hydration mismatch: server renders it, the
    `typeof window === undefined` guard renders null on client). NOT
    fixed here — it's delicate (the scroll-anchor + theme-flash fixes were
    hard-won); fix separately with a non-React script technique.

## HIGH PRIORITY (asked for, near-term)

### Activity completion-type options

Two new axes for how an activity's completion behaves. Applies to
community-owned activities first; the second also belongs on the personal
calendar.

1. **Community aggregate completion.** Alongside today's collective
   completion (any one member marks the single shared occurrence
   done/missed for the whole community), add a completion type where each
   member's status is tracked and the occurrence records the group's
   progress as a fraction — e.g. 3/4 members did it → "3/4". Needs a
   per-(occurrence, member) status table for these activities, plus a UI
   that shows the fraction and lets a member mark THEIR own.
   - **Stretch:** link a community aggregate activity to members'
     PERSONAL activities so that when a member completes it on their own
     regular calendar it also +1's the group's counter for that
     occurrence (one action, counts in both places). Decide the linkage
     (auto-create a personal copy that references the community occurrence,
     or let a member "link" an existing personal activity).

2. **Stays-until-marked vs. auto-drop-when-past.** ✅ DONE for the PERSONAL
   calendar (migration 0059: `activities.auto_resolve`). Toggle in both
   Add-Activity forms (standalone + day-list modal/edit), persisted in
   create/draft/edit. Behavior: `visibleOnDay()` drops a past-due pending
   auto_resolve occurrence from the day list, and `fetchIncompleteInfo()` +
   the /notifications reminders query exclude them (no unlabeled nag).
   STILL TODO: honor it in the Grid (past auto_resolve cells should read
   blank, not overdue) and add the same setting to community-owned
   activities (needs community_owned_activities.auto_resolve + the same
   visibleOnDay path, which already reads DayInstance.activity.auto_resolve
   — so mapping it through getCommunityOwnedBundle is most of the work).
   Original spec below:
   - *Stays until marked* (today's behavior) — an unmarked past occurrence
     becomes overdue/unlabeled and waits for a verdict.
   - *Auto-drop when its date/time passes* — the occurrence just
     disappears once past, no Complete/Missed needed. Lets someone drop a
     bunch of meetings on the calendar for scheduling only, without the
     nag to mark each one.
   Check whether the personal calendar already has an equivalent (the
   rollover setting is related but NOT the same — rollover is about what
   happens WHEN missed, not about skipping the verdict entirely). If it
   doesn't exist on the individual calendar, add it there too — it's
   generally useful. Likely a new `activities` column (e.g.
   `auto_resolve` / `requires_verdict`) honored by the day-list + the
   "incomplete/unlabeled" logic + backfill.

## Pending features (asked for, deferred on purpose)

### Communities (Groups / Clubs / Guilds)

Asked for. Three community types live inside the Friends surface as
sibling sub-tabs (Friends / Groups / Clubs / Guilds), mirroring the
Schedule surface's Calendar / Streaks / Total pattern. The
scaffolding — sub-tab strip + empty per-type pages — is already in
place (see `app/friends/_friends-tabs.tsx`, `groups/page.tsx`,
`clubs/page.tsx`, `guilds/page.tsx`). This entry captures everything
those placeholders will eventually grow into.

**A user can belong to MANY of each type.** Each tab is a multi-
community shell: dropdown at the top to pick which one you're viewing,
+ New button to create one, and the body renders that community's
overall page / calendar / leadership settings.

**Schema shape — one shared `communities` table.**
```
communities (
  id uuid PK,
  kind text NOT NULL,           -- 'group' | 'club' | 'guild'
  name text NOT NULL,
  handle text UNIQUE,           -- for group's "special search"
  description text,
  visibility text NOT NULL,     -- 'private' | 'public'
  join_policy text NOT NULL,    -- 'open' | 'application' | 'invite'
                                --   groups default 'invite',
                                --   clubs configurable,
                                --   guilds configurable.
  outsider_visibility jsonb,    -- clubs: what non-members see
                                --   { showMembers, showActivities, ... }
  created_by uuid FK auth.users,
  created_at timestamptz,
  updated_at timestamptz
)

community_members (
  community_id uuid FK,
  user_id uuid FK auth.users,
  role text NOT NULL,           -- 'leader' | 'co_leader' | 'rank_<id>' | 'member'
  joined_at timestamptz,
  PRIMARY KEY (community_id, user_id)
)

community_ranks (
  id uuid PK,
  community_id uuid FK,
  name text NOT NULL,           -- e.g. "officer", "moderator"
  sort_order int,
  permissions jsonb NOT NULL    -- bitmap-ish:
                                -- { can_invite, can_approve_requests,
                                --   can_add_activities, can_edit_settings,
                                --   can_promote, can_demote, can_kick }
)

community_join_requests (
  id uuid PK,
  community_id uuid FK,
  user_id uuid FK,
  note text,
  status text,                  -- 'pending' | 'approved' | 'declined'
  handled_by uuid FK auth.users,
  created_at timestamptz
)

community_activities (
  community_id uuid FK,
  activity_id uuid FK activities,
  added_by uuid FK,
  added_at timestamptz,
  PRIMARY KEY (community_id, activity_id)
)

community_auto_add_prefs (
  community_id uuid FK,
  user_id uuid FK,
  auto_add boolean,
  PRIMARY KEY (community_id, user_id)
)
```

**Per-type behavior (all one table + policies):**

- **Groups** — `visibility='private'`, `join_policy='invite'` by
  default. Discovery is by exact `handle` or invite link only; the
  search endpoint filters `visibility='public'` out. Joining is
  request-then-approve or direct invite.
- **Clubs** — `visibility='public'`. Leadership sets
  `outsider_visibility` (name only / member count / full feed) and
  picks `join_policy` between open / application / invite. Public
  search endpoint returns clubs; filters exist for tag / activity /
  size.
- **Guilds** — like clubs but with skill/adventure progression baked
  in. Add two more tables when guilds ship:
  ```
  guild_tracks (id, community_id, name, kind='skill'|'adventure', tiers jsonb)
  guild_progress (guild_id, user_id, track_id, tier, updated_at)
  ```
  Guild activities pair to tiers; completions can advance a member on
  a track. Mentor pairing: `guild_mentors (guild_id, user_id)` + a
  `mentor_requests` table for newcomer-→-mentor asks.
- Guilds also feed the **Levels tab** — a member's overall Levels
  view aggregates skill progress across every guild they're in.

**UI per tab (same shape for all three, differs in policy widgets):**

- **Dropdown** at the top listing communities the user belongs to,
  most-recent-visited first. Empty state = "You're not in any {kind}
  yet — join one or create one."
- **+ New modal** — name, description, visibility (fixed for groups),
  join policy, initial rank names (auto-generates a "member" rank +
  a "leader" rank on the creator).
- **Overall page** for the selected community: members list,
  activity feed (each member's completions of the community's
  shared activities), rhythms shared into the community.
- **Calendar view** — the community's shared activities laid out in
  Calendar style (Day / Week / Month, same components as personal
  Calendar). Two toggles per activity: **Add to my calendar** (one-
  off insert into the member's activities via a copy-from-shared
  path — the CopyShareModal already exists) and **Auto-add new
  activities** (a `community_auto_add_prefs` row per (community,
  user) — when a leadership add-activity mutation runs, fan out
  copies to everyone who has auto-add=true).
- **Leadership settings** — visible to leader + anyone whose rank
  carries `can_edit_settings`. Ranks table: add rank, name it, tick
  the per-permission checkboxes, save. Members list with a
  per-member "promote / demote" rank picker for anyone whose rank
  carries `can_promote`. Kick / ban with `can_kick`.
- **Discovery** — public search page (clubs / guilds only; groups
  are handle-only) with tag + size filters. Application flow:
  applicant writes a note; leadership sees a pending list; approve
  writes a `community_members` row, decline notifies the applicant.

**RLS + SECURITY DEFINER surface:**
- Read a community's basic row: anyone if `visibility='public'`;
  members-only if `visibility='private'`.
- Read `community_members`: gated by `outsider_visibility.showMembers`
  for non-members of public clubs, always OK for members.
- Read `community_activities`: same gating pattern.
- Mutations (insert/update/delete on activities, ranks, member
  roles) go through a SECURITY DEFINER RPC that checks
  `has_permission(auth.uid(), community_id, 'can_add_activities')`
  etc.
- Join requests: any authenticated user can INSERT a request into a
  public / handle-discovered community; only permitted members can
  UPDATE the status.

**Notifications integration:**
- New join request → notifies members with `can_approve_requests`
  (Notifications page + BottomNav badge).
- Approved / declined → notifies the requester.
- Invite → notifies the invitee.
- New auto-added activity → optional per-user notification
  (respect the auto_add pref — the whole point is it's silent).

**Phasing (biggest → smallest):**
1. **Schema + RLS** — all tables above, plus the SECURITY DEFINER
   permission helpers. Ship as a single migration once designed. ✅ DONE
   (migration 0031).
2. **Groups end-to-end** — dropdown, create modal, overall page,
   members, basic invite/request. No calendar or auto-add yet. ✅ DONE
   (shared `CommunityTab` across all three types).
3. **Calendar + auto-add** — shared component so all three types
   inherit it. Base = the full personal-style calendar; a leadership
   `calendar_display` setting ('full' | 'light') trims what members
   see. Base now defaults to 'full' (migration 0046). ✅ DONE — calendar
   UI (reuses FriendCalendar), leadership controls, and the auto-add
   fan-out (migration 0047: leadership add → copy into opted-in members'
   schedules) all shipped.
4. **Community Settings** — a per-community Settings AREA (expandable),
   not a single screen. First sections: **Leadership** (ranks,
   per-permission checkboxes, member role picker), **Admittance** (join
   policy / approvals), and **Chat** (enable the chat + who-can-speak).
   `community_ranks` table already exists (0031); needs UI + permission
   RPCs. ✅ DONE — Settings section (migration 0041) with member role
   management, admittance (join policy / visibility), show-members
   toggle, and chat settings. Custom per-rank permissions now shipped
   too (migration 0051): a `has_community_permission` resolver gates every
   operational RPC (invite / approve / add-remove activity / kick /
   promote), a Ranks editor in Settings creates ranks with a
   per-permission bitmap, and members can be assigned a `rank:<id>` via
   the role picker. Leadership (leader/co_leader) still resolves to all
   permissions; the role picker guards against non-leaders granting
   leadership. Each Settings section is now gated on its specific
   permission, and the Settings tab shows for anyone with any management
   permission.
5. **Clubs discovery** — public search, application flow,
   outsider_visibility widget. ✅ DONE — public search
   (searchPublicCommunities) + handle lookup (findCommunityByHandle,
   migration 0042) + request-to-join note flow via DiscoverModal. The
   `outsider_visibility` widget shipped too (migration 0054): leadership
   toggles "Preview members" / "Preview activities" in Settings →
   Admittance (public communities only), and the DiscoverModal has a
   per-result Preview panel showing member count always + roster/activities
   when permitted, via the get_community_preview SECURITY DEFINER read.
6. **Invites + notifications** — invite people directly (not just
   request-to-join); notify members of join requests / approvals / new
   auto-added activities. ✅ DONE — direct invites by username or friend-
   search dropdown (migration 0048), leadership sees pending sent invites
   with cancel + incoming join requests on /notifications (migration
   0049), and requesters get approved/declined outcome notices (migration
   0050). All counted in the nav badge. Auto-add notifications shipped too
   (migration 0055): an opt-in "Notify me when they're added" toggle
   (shown next to Auto-add), a community_auto_add_events feed that the
   add-activity fan-out writes to for opted-in members, and a dismissible
   "Added to your calendar" section on /notifications + badge count.
7. **Community chat** — per-community group chat with filterable system
   notices for community changes. Gated by the Chat settings from
   phase 4. See "Community chat" below. ✅ DONE (migrations 0043/0044) —
   community_messages + post/read RPCs, system notices for
   add/remove-activity, join/leave/kick, role change; "Hide updates"
   filter in the chat header.
8. **Guild tracks** — the guild-specific progression + Levels feed.
   DEFERRED (per user: "not ready for a bit").

Meaningful build — pick up one phase per session, don't try to land
it all at once.

**Community-owned calendars (in progress).** Per user: each community
should be a first-class calendar owner — its OWN activities + occurrences
and its own Day/Week/Month/Year view, "just like each individual person
has." Decisions locked in: **collective/shared completion** (any member
marks an occurrence done for the whole community — one shared status per
occurrence) and **ranks-gated management** (adding/editing gated by
`can_add_activities`; completing open to any member).
- ✅ Phase 1 (migration 0056): dedicated `community_owned_activities` +
  `community_owned_instances` tables (SEPARATE from personal
  activities/activity_instances so the core calendar is untouched),
  SECURITY DEFINER RPCs (create / insert-instances / set-status /
  archive), TS materialization via `generateInstances` + a per-view
  backfill, and a new `CommunityOwnedCalendar` on the community Calendar
  tab: FriendCalendar (Day/Week/Month/Year) over the community's own
  activities, an "+ Add activity" create modal, and a collective
  Complete/Missed/Reset modal on tap. The old "shared by members"
  copy/auto-add list now sits BELOW as a secondary section (its duplicate
  calendar render was removed; the light/full `calendar_display` setting
  is now unused — candidate for removal).
- ✅ Phase 2 (later same effort): the member-share/copy/auto-add UI was
  REMOVED from the Calendar tab per user ("remove the function to add
  your own activities") — CommunityActivitiesSection deleted, bundle
  trimmed to owned-only. The community Calendar tab now also has a
  **Calendar / Grid** switcher: Calendar = FriendCalendar
  (Day/Week/Month/Year), Grid = FriendGrid (Week/Month/Total/Custom +
  tag filter), both reusing the dashboard components read-only over the
  community's OWN activities. Grid cells + calendar occurrences both open
  the collective Complete/Missed/Reset modal. The share/copy/auto-add
  server actions + tables still exist but are no longer surfaced (auto-add
  notifications are now vestigial — nothing triggers them).
- ✅ Phase 3 (edit + archive): `update_community_activity` (migration 0057
  — updates the row + clears future PENDING occurrences, caller
  re-materializes) + `updateCommunityCalendarActivity`; the create modal
  is now a create/edit `ActivityFormModal` (prefilled from the existing
  activity); a leadership-only "Manage activities" list under the calendar
  with Edit + Archive (archive reuses `archiveCommunityCalendarActivity`).
- ✅ Phase 3b (archived view): migration 0058 adds
  restore_community_activity + delete_community_activity (both
  can_add_activities-gated; delete cascades occurrences). The bundle now
  carries archivedActivities; the "Manage activities" list has a
  "Show archived (N)" toggle with Restore + permanent Delete (confirm)
  per archived activity — mirrors the personal "delete only from
  Archived" rule.
- ✅ Phase 3c (richer form): the community create/edit ActivityFormModal
  now matches the personal Add-Activity form's mainstream fields —
  rhythm labels (Once / Daily / Days per Week / Every N Days / Target
  Count), per-slot **end times** (scheduled_end_times), multi-time Daily →
  frequency conversion, and a real **tag picker** (palette chips from the
  community's tag map + free-text add) replacing the comma field. Priority
  is intentionally omitted (removed product-wide). Pinned / Streaks-toggle
  / Rollover / Reminders were intentionally SKIPPED — they don't map to a
  community (no Total view for pinned, no rollover behavior on collective
  instances, reminders unbuilt). "Pick Dates" (selection) also skipped.
- STILL TODO: inline completion in the Day list (currently tap-opens-modal,
  not inline Complete/Missed buttons like the dashboard) — NEXT; Year-view
  name banners; per-viewer streak/stats in the community Grid (currently
  streakMode "none"). Also decide whether to fully delete the now-dead
  member-share/copy/auto-add backend.

**Community chat (phase 7).** Every community gets a group chat, distinct
from the 1:1 friend DMs (`messages` table + `ChatThread`). Reuse that
machinery where practical.
- **Schema:** a `community_messages` table (id, community_id, sender_id
  NULLABLE for system posts, kind text `'message' | 'system'`,
  system_event jsonb for structured change data, body text, created_at).
  RLS: members read (via `is_community_member`); INSERT gated by a
  SECURITY DEFINER RPC that checks the community's who-can-speak setting
  + the caller's role.
- **System notices:** community changes auto-post a `kind='system'`
  message — activity added/removed, member joined/left/kicked, rank or
  permission change, settings change, name/description edit. Emit these
  from the existing mutation RPCs/actions as each lands (e.g.
  `add_community_activity` already exists — hook it when chat ships).
  Render like the existing `is_help_request` / `is_share_notification`
  message kinds (full-width panel, not a normal bubble).
- **Filter:** a toggle in the chat header to hide/show system notices
  (default show; "Only messages" hides them). Client-side filter over
  the fetched list.
- **Settings (phase 4 → Chat section):** `communities.chat_enabled`
  bool + `communities.chat_who_can_speak` text
  (`'everyone' | 'leadership' | 'ranked'`). Non-speakers see the chat
  read-only. Disabling chat hides the surface.
- **Notifications:** new messages can notify members (respect a future
  per-user mute) — ties into phase 6.

### AI-assistant pairing

Asked for. Allow the user to pair Mission with an AI assistant (Claude
or similar) that would:

- Ingest the user's goals + current rhythms and **create activities
  for them** (drafts they approve before commit — never silent writes).
- **Check in** on schedules and past-due items; nudge in-app + optional
  push/email.
- **Coach** based on completion patterns — surface which rhythms are
  slipping, suggest cadence adjustments, celebrate streaks.
- Optionally act as a chat participant on shared activities (behave
  like a friend for the "ask for help" flow).

Design notes for whenever this ships:
- Add an "Assistants" tab on /settings with an opt-in toggle + scope
  picker (read-only insights, or write-new-activity, or full agent
  access). Default OFF; agent scopes are least-privilege.
- Store the assistant identity (name, avatar, provider) on a new
  `profiles.assistant_*` set of columns OR a dedicated
  `assistants` table if we support multiple.
- All AI-created rows carry a `created_by_assistant boolean` audit
  flag so the user can filter/undo.
- The provider integration is a separate concern — pick a single
  vendor at build time (Anthropic first-party is the obvious pick),
  but keep the surface `sendToAssistant(prompt) -> response` so
  swapping is easy.

Meaningful build — not a one-off. Pick up as a contained phase.

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

## Form-type activities (survey-style completion)

Asked for. A NEW activity kind ("Form") alongside the existing
single/daily/weekdays/interval/frequency rhythms — really an
orthogonal "what does completing this activity LOOK like" axis.

Today completing an activity is a one-tap binary verdict (Complete /
Missed). A Form activity replaces the Complete button with a "Form"
button that pulls up a modal containing a user-defined survey/form
(Google-Forms-style fields), and submitting the form is what records
the completion — with the field values stored as structured data so
they can be charted and analyzed later.

**Authoring (creation/edit flow):**
- In "Add activity" (and Edit Rhythm) add a "Form" toggle/section
  alongside the rhythm picker. Opens a form builder.
- Field types to support, in priority order:
  - Short text / Long text
  - Number (with optional min/max/unit suffix like "lbs", "min")
  - Slider / scale (1–5, 1–10, custom range)
  - Single-select (radio) / multi-select (checkboxes)
  - Date / time / duration
  - Yes/No
- Per-field: label, required flag, optional default, optional help
  text. Reorderable. Add/remove fields freely on Edit Rhythm.
- Form schema lives on the activity (new column, e.g.
  `activities.form_schema jsonb`). Versioning matters: editing the
  schema must NOT invalidate past submissions; either snapshot the
  schema-version-id onto each submission OR keep the schema
  append-only with field-deprecation flags. (Snapshot is simpler.)

**Completion (run-time flow):**
- The day list / grid / modals replace "Complete" with "Open form"
  (or just "Form"). Tapping opens the form modal pre-filled with the
  current schema.
- Submitting the form:
  - Creates the usual `completion` row (so streaks, X/Y, and
    everything else keep working unchanged).
  - Plus a new `completion_form_responses` row holding the answers
    as jsonb + a snapshot of the schema-version-id used.
- "Missed" still works the same way (skip the form entirely).
- Edits to a past submission allowed via History → modal → edit
  (creates a revision row rather than mutating in place, so the
  audit trail stays clean).

**Surfacing the data:**
- History (per activity, all-activities, and the future graph view)
  shows each completion as a row with its form values inline (or a
  "View response" expander for long forms).
- Analytics / graphs (own section or under Total view):
  - Numeric / slider fields → line graph or histogram over time.
  - Single/multi-select → bar chart of value frequencies.
  - Filter by date range / tag.
- Friend view: if the activity is shared with progress, the friend
  sees the same form on a completed row (read-only).

**Storage sketch (subject to schema review when this lands):**
```
activities.form_schema jsonb   -- null = legacy non-form activity
activities.form_version int    -- bumped on every schema edit
completion_form_responses (
  completion_id uuid PK FK,
  schema_version int,
  answers jsonb                -- { field_id: value }
)
```

**Out of scope for v1:**
- Conditional/branching logic (show field B only if A == "Yes").
- Multi-page forms.
- Public/anonymous form submission. This is for the OWNER and their
  friends only — not a public form-collection tool.

This is a meaningful build (new schema, new mutation path, new
visualizations) — pick it up as a contained phase, not a one-off.

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

- **Rollover-missed rows only surface in the origin day's dropdown.**
  When a missed instance rolls forward and gets marked missed on a
  later day, the Completed/Missed dropdown on the LATER day doesn't
  show it — the row is still keyed to its original `scheduled_for`,
  so it appears in that origin day's dropdown instead. Might be
  worth changing so the dropdown of the day the miss was *decided
  on* surfaces the row (or shows both). Not sure yet — leaving as a
  potential future change.
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
- **Two tabs in one browser share the same login.** Auth is cookie-based
  (`@supabase/ssr` — `createBrowserClient` + server/middleware read the
  same cookies), and cookies are per-browser-profile, not per-tab. So
  signing into account B in one tab silently switches the other tab to
  account B too. This only bites multi-account *testing*; for that use an
  incognito window, a second browser, separate Chrome profiles, or
  Firefox containers (each has its own cookie jar). Making the app itself
  support two logins in two normal tabs would mean moving the session off
  SSR cookies (or layering a tab-scoped `sessionStorage` token on top),
  with real security/page-load tradeoffs. Assume this is moot once this
  becomes a real end-user app (nobody runs two of their own accounts at
  once) — only revisit if simultaneous multi-account in one browser
  becomes an actual product feature.
