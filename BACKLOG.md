# Mission — Backlog

Captured ideas and follow-ups for future sessions. Not in priority order.
Imported by `CLAUDE.md` so every new Claude Code session sees this on
startup.

## Recently done

- ✅ Share daily completion total with friends (migration 0079): a per-friend
  "Share my daily total" toggle (in the Share modal) lets a friend see your #/#
  completed each day WITHOUT the activities themselves (individual activities
  still require per-activity sharing). `daily_total_shares` table +
  `get_friend_daily_totals` aggregate-only SECURITY DEFINER read; the friend
  profile page shows a "Daily total" section (today's N/M + a recent-days strip)
  when they've shared it. Reads degrade to empty/off if 0079 isn't applied.
- ✅ First-run intros + terms/disclaimers foundation (migration 0077):
  `user_acknowledgments` store + `getAcknowledgments`/`acknowledge`, agreement
  content in `lib/domain/agreements.ts`, and reusable `FirstRunPopup` +
  `TermsModal`. Wired into Coaches: tab intro, coach-conduct agreement gating
  Apply, client disclaimer gating engaging a coach. Community gating is a
  drop-in follow-up.
- ✅ Coaches marketplace — phase 3 (migration 0076): share your activities WITH
  a coach. The `activity_shares` INSERT policy now allows coaching pairs (like
  friends); "Your coaches" gets a Share button, and a coach reviews a client's
  shared routines via "View shared" (read-only calendar). This completes the
  Coaches marketplace (phases 1-5 done; only payments deferred).
- ✅ Coaches marketplace — phase 5 (migration 0075): reviews/ratings. A client
  who worked with a coach leaves a 1-5 star review (+ text); the directory shows
  the average + a "See reviews" list. Only phase 3 (share your own activities
  with a coach) remains of the Coaches plan.
- ✅ Coaches marketplace — phase 4 (migration 0074): the coach activity cache.
  Coaches keep a library of activity templates and send them to clients as
  offers; the client accepts → it materializes on their calendar. Templates:
  create/edit (shared ActivityFormFields) / duplicate / archive / send; clients
  get a "Plans from your coaches" inbox with Add-to-my-calendar / Decline. (Note:
  phase 3 "share your activities with a coach" is still pending.)
- ✅ Coaches marketplace — phase 2 (migration 0073): coach↔client chat.
  `coaching_relationships` + start/end + my-coaches/my-clients RPCs; the
  `messages` policy now permits coaching pairs (not just friends); "Message
  coach" on directory cards, "Your coaches"/"Your clients" lists, and a
  `/friends/coaches/[coachId]/chat` route reusing ChatThread. (Phase 1 apply→
  verify→directory verified live; phase-2 chat needs two accounts to verify.)
- ✅ Coaches marketplace — phase 1 (migration 0072): apply to be a coach →
  admin verify/reject → public "Find a Coach" directory (photo, bio, price/day
  or /week, rating). `profiles.is_admin` gates verification. Coaches tab now
  live (directory + apply form + admin queue); chat / activity sharing / coach
  template cache / reviews are later phases. (See "Coaches" plan section.)
- ✅ Community page layout phase 2 (migration 0071): leadership can add **Total
  View** and **Streaks** as their own show/hide/reorderable top-level community
  tabs. Non-disruptive (opt-in; default order + the Calendar tab's internal
  switcher unchanged). A dedicated tab renders the view with the switcher hidden.
- ✅ Link community aggregate activity → personal calendar (migration 0070):
  "+ Add to my calendar" on an aggregate activity creates a linked personal copy;
  completing/missing/reverting it on the personal calendar mirrors onto the
  member's group aggregate status (same date) via a SECURITY DEFINER trigger, so
  the group's N/M updates from one action. (See HIGH PRIORITY → aggregate
  completion → Stretch.)
- ✅ Fix ICS calendar feed (migration 0069): the calendar-sync UI +
  `profiles.ics_token` (0025) were live but `/api/calendar/<token>.ics` 404'd
  because the `get_instances_by_ics_token` RPC wasn't present in the live DB.
  0069 re-creates it (idempotent) + reloads the PostgREST schema cache. (ICS
  export + the 12h/24h time-format toggle were both already fully built — the
  backlog was just stale; entries updated.)
- ✅ Leadership-configurable community page layout — phase 1 (migration 0068):
  Settings → "Page layout" lets leadership show/hide/reorder the member tabs
  (Home / Calendar / Chat); the shell tab strip reads `communities.page_layout`
  instead of the hardcoded order. Settings stays leadership-only. (See the
  "Leadership-configurable community page display" entry for remaining phases.)
- ✅ Community activity auto-resolve toggle (migrations 0060/0066): the
  community create/edit form now exposes "Stays until marked" / "Auto-complete
  when past" (shared ActivityFormFields `showAutoResolve`). Past-due pending
  auto-resolve occurrences auto-complete via `auto_complete_community_past_due`
  instead of nagging. Verified live. (See HIGH PRIORITY item 2.)
- ✅ Community aggregate completion UI (migrations 0061/0062): the "Per-member
  (3/4)" completion type now has a full UI — Day list shows "N/M" + ✓/✗
  self-mark inline; Week/Month/Streaks taps open an AggregateModal (fraction +
  "I did this"/"I didn't", tap-to-clear). Collective activities keep the
  one-mark modal. Verified live. (See HIGH PRIORITY → aggregate completion.)
- ✅ Public (no-login) community calendar (migration 0067): a per-community
  "Public calendar page" toggle in Settings → Admittance (public communities
  only) exposes the community's own calendar at `/c/<id>`, read-only, with no
  login. Anon-safe `get_public_community_calendar` SECURITY DEFINER read (granted
  to anon + authenticated) returns activities/occurrences ONLY when
  `public_calendar=true AND visibility='public'`; member-only RLS untouched.
  Copy-link affordance next to the toggle. Verified live: anon fetch (no cookie)
  → 200 + renders read-only; nonexistent + private communities → 404.
- ✅ Multi-day events (migrations 0065/0066): a "Once" activity with an
  end_date later than its start is a multi-day event — materializes one
  occurrence per day across the span, defaults to Auto-Complete (comment-only;
  past days auto-complete), and renders as a grouped bar (name shown once,
  status-colored, squared inner corners) across Week + Month on personal,
  friend, and community surfaces. 3-way completion mode (Mark/Auto/Both) on
  the personal forms; community uses collective/aggregate (mode toggle hidden).
  Verified live.
- ✅ Remove the redundant "← Mission" back links from the bottom-nav tab
  pages (Community shell, Levels, Adventures, Settings index) — the global
  BottomNav's Schedule tab already returns to the calendar. Kept the
  intra-Settings "← Settings" links and the Notifications back link (those
  aren't bottom-nav destinations).

## Multi-day events — follow-ups

- **Seamless span bars.** ✅ DONE for **Month** (personal + community via
  MonthSection/MonthBannerPill — gap-x-0 + drop `w-full` so the pill stretches
  and −mx reaches the cell edge) and ✅ **Week** (personal WeekView + friend/
  community WeekGrid — an **overlay lane**: a second grid-cols-7/gap grid above
  the cells where each span is ONE grid item spanning its columns + their gaps,
  greedy lane stacking, cells reserve lane space, squared where it continues
  past a week edge). ONLY REMAINING: the **friend MonthGrid** (the friend
  view's Month — community Month already uses the seamless MonthSection). It's
  the hardest: a 6-week grid, so the Week overlay must be applied PER WEEK ROW
  with spans split at week boundaries. Restructure MonthGrid into 6 relative
  week-row containers (cells + a per-row span overlay), reusing the WeekGrid
  lane logic. Read-only/secondary surface, so lower priority.
- **Add-form schedule preview.** The standalone /new form's "Schedule preview"
  shows a multi-day event as "1 occurrence" on the start day — it previews the
  single rhythm, not the materialized span. Make the preview expand a multi-day
  single to its per-day span so the count/preview matches what's created.
- **Status coloring vs one bar.** Past days of a multi-day event auto-complete
  (grey) while today/future stay pending (accent), so a spanning event shows a
  two-tone bar. That's informative (progress) but if a single uniform bar is
  preferred, derive the bar color from the activity, not per-occurrence status.

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

1. **Community aggregate completion.** ✅ DONE (migrations 0061/0062). A
   community activity's completion type is pickable in the create/edit form
   ("Shared (one mark)" vs "Per-member (3/4)"). Per-(occurrence, member)
   status lives in `community_owned_instance_members`; a member marks THEIR
   OWN via `set_community_member_status` ('completed' | 'missed' | 'none' to
   clear), and `get_community_aggregate_status` returns {marked, total,
   myStatus} per occurrence (loaded into the bundle's `aggregateByInstance`,
   denominator = current member count). UI: the Day list renders the fraction
   "N/M" inline with ✓ / ✗ self-mark buttons (InstanceRow aggregate branch);
   tapping an aggregate occurrence in Week / Month / Streaks opens an
   `AggregateModal` (fraction + "I did this" / "I didn't do this", tap-active-
   to-clear) instead of the collective Mark-complete/missed modal. Collective
   activities are unchanged. Verified live: 0/1 → ✓ → 1/1 → clear → 0/1, and
   collective rows still show Complete/Missed.
   - **Stretch — ✅ DONE (migration 0070).** Chose the auto-create-a-linked-
     copy approach: `activities.linked_community_activity_id` back-references the
     community aggregate activity. `linkCommunityAggregateActivity` adds it to
     the member's own calendar (copies name/rhythm/times/dates/tags, materializes
     matching-dated instances); `unlinkCommunityAggregateActivity` archives the
     copy. A SECURITY DEFINER trigger `propagate_linked_aggregate` on
     activity_instances status changes mirrors the owner's completed/missed/
     reverted status onto their `community_owned_instance_members` row for the
     same-dated community occurrence (one-way personal→community; zero latency on
     the completion path). The AggregateModal has "+ Add to my calendar" /
     "✓ On your calendar — remove"; the bundle carries `linkedAggregateIds`.
     Reachable from every view: tapping an aggregate row's body in the Day list
     ALSO opens the AggregateModal (verified), so linking works from Day as well
     as Week/Month/Streaks. Verified live end-to-end: linked Team Pushups →
     completed today on the personal calendar → the community aggregate for that
     day bumped 0/1 → 1/1 via the trigger. STILL TODO (optional): reverse sync
     (community mark → personal) if wanted.

2. **Stays-until-marked vs. auto-drop-when-past.** ✅ DONE for the PERSONAL
   calendar (migration 0059: `activities.auto_resolve`). Toggle in both
   Add-Activity forms (standalone + day-list modal/edit), persisted in
   create/draft/edit. Behavior: `visibleOnDay()` drops a past-due pending
   auto_resolve occurrence from the day list, and `fetchIncompleteInfo()` +
   the /notifications reminders query exclude them (no unlabeled nag).
   Grid now honors it too — a past-due auto_resolve cell renders blank
   ("not-scheduled") instead of overdue, and doesn't count toward
   unlabeled. ✅ DONE for COMMUNITY-OWNED activities too (migrations
   0060/0066): the create/edit ActivityFormModal now shows a 2-way
   "Stays until marked" / "Auto-complete when past" toggle
   (`showAutoResolve` on the shared ActivityFormFields; it reuses the
   completion-mode state so the hidden `autoResolve` input + the multi-day
   auto default still work). autoResolve threads
   community_owned_activities → SharedActivity → DayInstance, and
   `auto_complete_community_past_due` (0066, called on bundle load)
   auto-completes past-due pending auto_resolve occurrences so they resolve
   instead of nagging. Verified live: create with Auto selected → edit
   shows it selected. Original spec below:
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
- ✅ The community Calendar tab now has the full personal-style view
  switcher: **Total View / Calendar / Streaks** (Streaks = the grid; renamed
  from "Grid" to match the personal terminology). Total reuses the friend
  `TotalReadOnly` in a trimmed read-only mode (no Copy / Reminders, cards
  non-clickable — the community has no rhythm-level detail modal), fed the
  community's own + archived activities so the Status/Tag/Rhythm grouping and
  All/Active/Archived filter work.

**Leadership-configurable community page display (asked for).**
✅ PHASE 1 DONE (migration 0068): leadership can show/hide/reorder the
member-facing sub-tabs (Home / Calendar / Chat) via Settings → "Page layout".
Stored as `communities.page_layout jsonb` (ordered array of tab keys; NULL =
default home→calendar→chat). `set_community_page_layout` (can_edit_settings,
validates known keys / no dupes / ≥1) + `setCommunityPageLayout`; the shell's
tab strip now reads `detail.pageLayout` (normalized via `normalizePageLayout`,
`MEMBER_TABS`/`DEFAULT_PAGE_LAYOUT`) instead of the hardcoded order, and the
selected view clamps to an available tab. Settings stays leadership-only and
is NOT part of the config.
- ✅ PHASE 2 (Total/Streaks tabs) DONE (migration 0071): "total" and "streaks"
  are now valid member tabs leadership can show/hide/reorder. Non-disruptive —
  DEFAULT_PAGE_LAYOUT is unchanged (home/calendar/chat), so Total/Streaks are
  opt-in; the Calendar tab keeps its own Total/Calendar/Streaks switcher. When a
  community adds a Total or Streaks top-level tab, it renders
  `CommunityOwnedCalendar` with a `forcedView` ("total"/"grid") and the internal
  switcher hidden. `set_community_page_layout`'s allowed keys expanded to
  include total/streaks (0071).
- STILL TODO: members + activity-feed as configurable sections; per-section
  **outsider vs member** visibility (ties into `outsider_visibility` 0054); and
  letting the public `/c/<id>` page and the Discover preview honor the layout.

**Public (no-login) community calendar sharing.** ✅ DONE (migration 0067) —
see "Recently done". Possible follow-ups: expose it at the community's
`/c/<handle>` (not just `/c/<id>`); add Week/Month/Year + Grid parity checks on
the public page; and decide whether the global app chrome (bottom nav) should be
hidden on `/c/[id]` for logged-out visitors (per user: keep it for now).

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

### Coaches (professional coaching marketplace)

Asked for. A paid professional-coaching marketplace living on the Coaches
sub-tab of the Community surface. To be listed, a user applies and is verified
by a platform admin (for now, just the owner). Members browse "Find a Coach",
chat with current/past coaches, and share specific activities with them.
Coaches keep a reusable "cache" of activity templates they can mass-send to
clients (who accept, then execute), with easy per-client tweaks.

**Phasing:**
1. **Profiles + apply/verify + directory.** ✅ DONE (migration 0072).
   `profiles.is_admin`; `coach_profiles` (bio, photo_url, price_amount,
   price_unit day|week, status pending|verified|rejected); `coach_reviews`
   (rating 1-5 + body; write UI later). RPCs: `apply_as_coach`,
   `set_coach_status` (admin), `get_coach_directory` (verified, public),
   `get_pending_coach_applications` (admin), + `getMyCoachProfile`/
   `isCurrentUserAdmin`. Coaches tab (`app/friends/coaches/`): "Find a Coach"
   directory (photo/bio/price/rating), apply/edit form with status badge, and
   an admin verify/reject queue. NOTE: admin is gated on `profiles.is_admin` —
   set yourself admin once:
   `UPDATE public.profiles SET is_admin = true WHERE id = '<your-user-id>';`
2. **Coach↔client chat.** ✅ DONE (migration 0073). `coaching_relationships`
   (coach_user_id, client_user_id, status active|ended) + `start_coaching` /
   `end_coaching` / `get_my_coaches` / `get_my_clients` /
   `get_coaching_counterparty` RPCs. The `messages` INSERT policy now allows a
   pair joined by EITHER an accepted friendship OR an active coaching
   relationship, so coach↔client DMs work without friendship. UI: "Message
   coach" on each directory card (engages, idempotent, then opens the chat),
   "Your coaches" + "Your clients" lists (Chat / End), and a dedicated
   `/friends/coaches/[coachId]/chat` route reusing the shared ChatThread. NOTE:
   full live verification needs two accounts (a verified coach + a client),
   since `start_coaching` requires a verified coach and you can't coach
   yourself.
3. **Share activities with a coach.** ✅ DONE (migration 0076). The
   `activity_shares` INSERT policy now permits a pair joined by a friendship OR
   an active coaching relationship, so a client shares activities with their
   coach via the existing `shareActivity` flow. UI: the shared `ShareRhythmsButton`
   on each coach in "Your coaches"; the coach reviews a client's shared routines
   via a "View shared" link → `/friends/coaches/[coachId]/shared` (read-only
   FriendCalendar over `getSharedByUser`, which filters get_shared_with_me /
   get_shared_instances_with_me to that owner). Reads were already
   relationship-agnostic.
4. **Coach activity cache (templates) + send-to-client.** ✅ DONE (migration
   0074). `coach_activity_templates` (coach-owned library: name, notes, rhythm,
   times, tags) + `coach_activity_offers` (a snapshot sent to a client, status
   pending/accepted/declined, with a start_date). Offer INSERT is RLS-gated to
   the coach of an ACTIVE coaching relationship; the client updates status.
   `get_my_coach_offers` RPC for the client's inbox. Actions in coaches.ts:
   template CRUD (create/update via the shared ActivityFormFields +
   `parseActivityTemplateForm` in lib/domain), archive, **duplicate** (for
   per-client tweaks), `sendCoachOffer`, `acceptCoachOffer` (materializes a
   personal activity on the client's calendar via generateInstances) /
   `declineCoachOffer`. UI (coach-plans.tsx): "Your coaching plans" library
   (New/Edit/Duplicate/Archive/Send) for coaches, and "Plans from your coaches"
   (Add to my calendar / Decline) for clients. NOTE: full live test needs a
   verified coach + an active client (two accounts).
5. **Reviews/ratings.** ✅ DONE (migration 0075). `submit_coach_review` (upsert;
   requires a coaching relationship, can't self-review), `get_coach_reviews`
   (public), `get_my_coach_review` (prefill). UI: a "Review" button on each coach
   in "Your coaches" (star picker + text, prefilled), and a "See reviews (N)"
   expander on directory cards (avg + count already shown from 0072).
6. **Payments.** Out of scope initially; price is display-only in phase 1.
   Booking/billing is a later, separate concern.

Phases 1-5 are all shipped — the Coaches marketplace is feature-complete except
phase 6 (payments), which is intentionally deferred.

### First-run page intros + terms/disclaimers (asked for)

✅ FOUNDATION + COACHES DONE (migration 0077). A single `user_acknowledgments`
table (user_id, ack_key, version) backs both, read via `getAcknowledgments` and
written via `acknowledge`. `lib/domain/agreements.ts` holds each intro/terms
(stable key + required version + copy) and a `needsAck(acks, agreement)` helper;
`app/_components/agreement-prompts.tsx` has `FirstRunPopup` (dismissible intro)
and `TermsModal` (blocking accept). Wired into Coaches: a first-run intro on the
tab, a coach-conduct agreement gating "Apply to be a coach" (first time), and a
client disclaimer gating engaging a coach (first time). ✅ Community CREATE now
gated too: a `COMMUNITY_CONDUCT_TERMS` agreement blocks the "+ New" community
flow on first use (CommunityTab takes `acks`, threaded from the groups/clubs
pages). STILL TODO: gate JOINING a community + becoming leadership; and an
optional Settings "replay intros" toggle. Original notes:

Two related needs:
- **First-time pop-ups per page/tab.** When a user opens a page/tab for the
  first time, show a brief intro popup explaining what it is / how to use it.
  Needs a per-user record of which intros have been seen (e.g.
  `profiles.seen_intros text[]` or a `user_seen_intros` table keyed by a stable
  intro id), a reusable `<FirstRunPopup introId=...>` that checks+marks seen,
  and copy per surface. Dismissible; "don't show again" is implicit (seen =
  dismissed). Consider a Settings toggle to replay intros.
- **Terms of agreement + disclaimers.** For Coaches and most Community
  features, gate first use behind an accept-the-terms step (so people can't
  abuse leadership/coach positions without acknowledging rules + liability
  disclaimers). Needs versioned terms (a `terms` doc + `user_terms_acceptance`
  (user_id, terms_key, version, accepted_at)) and a blocking modal on first
  entry to that surface (Coaches apply, creating/joining a community, becoming
  leadership, etc.) that records acceptance. Re-prompt when the version bumps.
  Coaches specifically: a coach must accept a coaching-conduct agreement before
  applying; clients see a disclaimer (coaching is not professional/medical
  advice unless stated) before engaging. Contained phase; build after the core
  Coaches phases.

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

### Time format toggle (12h vs 24h) ✅ DONE
Shipped: `profiles.time_format` ('auto'|'12h'|'24h'), the `lib/ui/format-time.ts`
+ `format-time-client.ts` helpers and a `useTimeFormat` hook, a TimeFormatPicker
on /settings/appearance, and time rendering routed through the helper
(instance-row, day-list, timeline-week, rhythm-summary, conflicts-list). No
further work needed here.

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

✅ DONE (migration 0025, fixed by 0069): per-user read-only ICS feed at
`/api/calendar/<token>.ics` (random rotatable `profiles.ics_token`, NOT the user
id), served by `app/api/calendar/[token]/route.ts` via the anon-safe SECURITY
DEFINER `get_instances_by_ics_token` RPC (−30..+180 day window), built by
`lib/domain/ics.ts`, with a "Calendar sync" section on /settings/appearance
(enable / copy http+webcal URL / rotate / disable), actions in
`app/actions/appearance.ts`. NOTE: the feed was returning 404 because the 0025
RPC wasn't present in the live DB (the `ics_token` column was) — migration 0069
re-creates the RPC + reloads the PostgREST schema cache. Apply 0069, then verify
the feed returns a VCALENDAR. Two-way sync (OAuth) remains out of scope.
Remaining nicety: one VEVENT per scheduled time for multi-time activities
(currently only the first time is used — see Multi-time reminders). Original
plan below for reference:

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
