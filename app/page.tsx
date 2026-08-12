// ---------------------------------------------------------------------------
// Home — the Mission dashboard.
//
// Logged out: marketing-y landing with sign-in / sign-up CTAs.
// Logged in:  calendar dashboard with a view switcher + a date param.
//   - ?view=day&date=YYYY-MM-DD    — that date plus the next 6, rolling
//   - ?view=week&date=YYYY-MM-DD   — the week containing that date
//   - ?view=month&date=YYYY-MM-DD  — the month containing that date
//   - ?date omitted → today.
//   - Click any day cell in Week or Month → jumps to Day view at that date.
// ---------------------------------------------------------------------------

import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  isAddActivityDensity,
  type AddActivityDensity,
} from "@/lib/domain/add-activity-density";
import {
  keepForCalendar,
  parseHideTags as parseHideTagsParam,
} from "@/lib/domain/calendar-filter";
import { isStreaksRange } from "@/lib/domain/streaks-range";
import { ensureInstancesBackfilled } from "@/lib/domain/backfill";
import {
  frequencyDueDay,
  isPastDuePending,
  unlabeledLandingDay,
} from "@/lib/domain/frequency-period";
import { rhythmCategoryLabel } from "@/lib/domain/rhythm-summary";
import {
  computeStreakValue,
  isStreakMode,
  type StreakMode,
} from "@/lib/domain/streak";
import {
  buildTagMap,
  computeTagUsage,
  tagChipClasses,
  type TagMap,
} from "@/lib/domain/tags";
import { createClient } from "@/lib/supabase/server";
import type { Rhythm } from "@/lib/validators/rhythm";

import { DateNavigator } from "./_components/date-navigator";
import {
  DayList,
  type DayInstance,
  type DayMarkedItem,
} from "./_components/day-list";
import { CalendarModifierChips } from "./_components/calendar-modifier-chips";
import { GridSection } from "./_components/grid-section";
import { type IncompleteInfo } from "./_components/incomplete-button";
import { DashboardHeader } from "./_components/dashboard-header";
import {
  MONTH_INITIAL_RADIUS,
  YEAR_INITIAL_RADIUS,
  type MonthBanner,
} from "./_components/month-cell";
import { MonthList } from "./_components/month-list";
import { YearList } from "./_components/year-list";
import type { MonthBannersByDate, YearCountsByDate } from "./actions/calendar-fetch";
import { readTimelinePref } from "./actions/timeline-pref";
import { SectionTabs } from "./_components/section-tabs";
import { TagDotRow } from "./_components/tag-chip";
import { TabPending } from "./_components/tab-pending";
import { listAcknowledgedPairKeys } from "./actions/conflicts";
import { TimelineWeek } from "./_components/timeline-week";

// Force a fresh server render on every request. The dashboard is a
// per-user personalized page anyway — nothing about it is meaningfully
// cacheable — and without this a CDN / RSC cache can serve HTML whose
// `todayStr` was baked days ago, which is why the Day view could open
// pinned to a stale date. `cookies()` inside supabase already makes the
// route dynamic; this line makes the intent explicit and belt-and-
// suspenders proof against future cache misconfiguration.
export const dynamic = "force-dynamic";

type ViewKind = "day" | "week" | "month" | "year" | "grid";
type GridRange = "week" | "month" | "total" | "custom";

// Default lookback for the Custom range when the user hasn't yet
// picked an explicit `from` / `to`. 30 days lets first-time visitors
// see a useful window without forcing them to pick dates first.
const CUSTOM_DEFAULT_DAYS = 30;

// Top-level "section" tab — Calendar groups the day/week/month/year
// views; Grid groups the habit-tracker week/month/total ranges.
type Section = "calendar" | "grid";

const CALENDAR_SUB_OPTIONS: ReadonlyArray<{ value: ViewKind; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

const GRID_SUB_OPTIONS: ReadonlyArray<{ value: GridRange; label: string }> = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "total", label: "Total" },
  { value: "custom", label: "Custom" },
];

// DayInstance (the shape passed to DayList) is imported from
// _components/day-list. WeekView still uses its own internal type below.

const WEEK_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// "Today" must be computed in the USER'S timezone, not the server's.
// Vercel runs in UTC, so `new Date().toISOString()` returns the UTC
// date — which is already "tomorrow" for any user west of UTC late in
// their day (e.g. 9pm Alaska = 5am next-day UTC). That was the
// "today is a day ahead" bug. We resolve the user's profile timezone
// per-request in HomePage and thread the result (`todayStr`) into
// every view + helper instead of reading a module-level UTC constant.
function todayInTimeZone(tz: string): string {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly our wire format.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    // Invalid/unknown TZ string → fall back to server UTC date.
    return new Date().toISOString().slice(0, 10);
  }
}

// Day view window: how many days back / forward from the selected date.
// Matches DayList's constants; controls how wide a slice we fetch.
const DAY_VIEW_BACK = 90;
const DAY_VIEW_AHEAD = 180;

// ---------------------------------------------------------------------------

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    date?: string;
    range?: string;
    /** Custom-range start (YYYY-MM-DD). Used only when range=custom. */
    from?: string;
    /** Custom-range end (YYYY-MM-DD). Used only when range=custom. */
    to?: string;
    /** Timeline overlay toggle ("1" / "true"). Only meaningful on
     *  view=day today; drives whether we render TimelineView or
     *  DayView. Legacy ?view=timeline still resolves the same way. */
    timeline?: string;
    /** Calendar tag filter (migration 0034). Comma-separated tag
     *  names to hide; empty string / absent = use user's profile
     *  default. The special sentinel "none" means "user explicitly
     *  cleared, don't apply the default". */
    hideTags?: string;
  }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <SignedOutLanding />;

  const params = await searchParams;

  // Cold-open reset: when the browser (or PWA / bookmark / typed URL /
  // "shortcut to home screen") loads this page fresh — `sec-fetch-site:
  // none` — strip any lingering ?date / ?view / ?range params and land
  // on today. This fixes "the app always opens to Thu May 21, 2026":
  // the URL was captured months ago by a navigation, then remembered
  // by the phone as the app's start URL. Internal <Link> clicks are
  // `same-origin`, so mid-navigation state (Next arrow → far-future
  // day, Grid Custom range, etc.) is preserved untouched.
  const h = await headers();
  const isColdOpen = h.get("sec-fetch-site") === "none";
  const hasStaleParams = Boolean(
    params.date || params.view || params.range || params.from || params.to
  );
  if (isColdOpen && hasStaleParams) redirect("/");

  const view = parseView(params.view);
  // Timeline is a sticky user preference (cookie), NOT a per-URL flag.
  // Turning it on in Day view keeps it on when the user drills into
  // Month or clicks a specific day. URL param `&timeline=1` still
  // wins if present (for the legacy `/?view=timeline` shape and for
  // shareable links), otherwise fall back to the cookie.
  const urlTimeline = parseTimelineFlag(params.view, params.timeline);
  const timelineOn = urlTimeline || (await readTimelinePref());

  // Note: `range` gets its FINAL value AFTER the profile fetch below,
  // because when the URL doesn't carry ?range we fall back to the
  // user's default_streaks_range preference (migration 0029).
  let range = parseGridRange(params.range);
  // Custom range params — only meaningful when range==="custom" but we
  // parse them up here so the GridView signature stays simple.
  const customFrom = parseOptionalDateParam(params.from);
  const customTo = parseOptionalDateParam(params.to);

  // ---- Batch 1: profile + tag palette -----------------------------------
  // The profile gives us BOTH the onboarding gate AND the user's
  // timezone (which we need to compute "today" correctly — see below).
  // The tag palette is independent of today, so it rides along in the
  // same parallel batch.
  const [profileResult, tagFetch] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "timezone, onboarded_at, add_activity_density, default_streaks_range, default_calendar_hidden_tags, default_untimed_open"
      )
      .eq("id", user.id)
      .maybeSingle(),
    Promise.all([
      // Archived tags don't show up in the picker or filter surfaces.
      supabase.from("tags").select("id, name, color").is("archived_at", null),
      supabase
        .from("activities")
        .select("default_skill_tags")
        .is("archived_at", null),
    ]),
  ]);

  // Onboarding gate: a signed-in user who hasn't completed onboarding
  // (profiles.onboarded_at IS NULL) gets bounced to /onboarding before
  // ever seeing the dashboard. Checking here also short-circuits Batch 2
  // for unboarded users. (We can't use requireOnboardedUser here because
  // that helper redirects to /login on no-user, but this page renders
  // <SignedOutLanding /> for that case instead.)
  const profile = profileResult.data;
  if (!profile || !profile.onboarded_at) {
    redirect("/onboarding");
  }

  // If the URL had no explicit ?range, honor the user's
  // default_streaks_range preference (Settings → Appearance → Streaks
  // default range). Defaults to 'total' both in the schema and here in
  // case the column reads back as something unexpected.
  if (params.range === undefined) {
    const stored = (profile as { default_streaks_range?: string })
      .default_streaks_range;
    if (isStreaksRange(stored)) range = stored;
    else range = "total";
  }

  // Calendar tag filter — URL wins; if the URL has no ?hideTags at all
  // (which is the state right after a cold-open strips params, or on a
  // fresh visit), fall back to the profile default. The special value
  // ?hideTags=none means "user explicitly cleared" and skips the
  // default. Applied to Day / Week / Month / Year / Timeline data on
  // the fetch path below; Grid has its own tag filter.
  const activeHiddenTags: string[] = (() => {
    const raw = params.hideTags;
    if (raw !== undefined) {
      return Array.from(parseHideTagsParam(raw));
    }
    const stored = (profile as { default_calendar_hidden_tags?: string[] })
      .default_calendar_hidden_tags;
    return Array.isArray(stored) ? stored : [];
  })();
  const hiddenTagsSet = new Set(activeHiddenTags);

  // "Today" in the USER'S timezone — NOT the server's UTC clock. This is
  // the fix for the "today is a day ahead" bug: Vercel runs in UTC, so
  // the old module-level `new Date().toISOString()` returned tomorrow's
  // date for any user west of UTC late in their day. Everything date-
  // relative (default landing date, incomplete cutoff, isToday highlight)
  // keys off this single value, threaded into every view + helper.
  const todayStr = todayInTimeZone(profile.timezone ?? "UTC");
  const date = parseDateParam(params.date, todayStr);
  const untimedOpenDefault: boolean = Boolean(
    (profile as { default_untimed_open?: boolean } | null)
      ?.default_untimed_open ?? false
  );

  // Add Activity form density — shapes every "Add / Edit activity"
  // surface that renders under this page. Threaded into DayView (and
  // its DayList/modal children) so a user who picked Compact sees the
  // condensed form both on /activities/new AND in the day-list "+"
  // modal + Edit Rhythm + Edit Activity — one setting, uniform effect.
  const addActivityDensity: AddActivityDensity = isAddActivityDensity(
    profile.add_activity_density
  )
    ? profile.add_activity_density
    : "compact";

  // Top up the user's activity_instances out to ~1 year ahead of whatever
  // they're looking at. Indefinite rhythms (no end_date) only get N days
  // of instances generated up front; without this, the calendar "runs
  // out" of future days after that window. Idempotent — already-present
  // instances are skipped via the unique index + ignoreDuplicates.
  const backfillThrough = (() => {
    const [y, m, d] = date.split("-").map(Number);
    const ref = new Date(y, m - 1, d);
    ref.setFullYear(ref.getFullYear() + 1);
    return format(ref, "yyyy-MM-dd");
  })();

  // ---- Batch 2: backfill + incomplete count -----------------------------
  // Both need the resolved `todayStr` / `date`, so they run after Batch 1.
  // They're mutually independent (backfill WRITES future instances,
  // fetchIncompleteInfo READS past ones — disjoint rows), so they
  // parallelize. The per-view fetch (inside DayView / GridView / etc.)
  // runs after this resolves and therefore sees the backfilled rows.
  const [, incompleteInfo] = await Promise.all([
    ensureInstancesBackfilled(supabase, user.id, backfillThrough),
    fetchIncompleteInfo(supabase, todayStr),
  ]);

  // ---- Tag palette ------------------------------------------------------
  // Per-user name → color lookup (queries ran in Batch 1). `usageByName`
  // tallies how many active activities use each tag so the picker's
  // "Most frequent" list sorts by popularity.
  const [{ data: tagRows }, { data: activityTagRows }] = tagFetch;
  const usageByName = computeTagUsage(
    (activityTagRows ?? []) as Array<{ default_skill_tags: string[] | null }>
  );
  const tagMap: TagMap = buildTagMap(
    (tagRows ?? []) as Array<{ id: string; name: string; color: string }>,
    usageByName
  );

  return (
    <main className="mx-auto flex h-full w-full max-w-2xl flex-col bg-white px-6 pt-6 dark:bg-zinc-950">
      {/* App-shell: this <main> is bounded to the app-shell scroll
          region in layout.tsx (viewport minus BottomNav). Vertical
          layout is:
            [header]
            [scrollable view body — flex-1 min-h-0 overflow-y-auto]
            [tabs at the bottom, above the global BottomNav]
          Per user spec: "move the calendar/streaks/total view and
          day/week/month/year and other such options to the bottom of
          the screen and invert them bottom to top and left to right."
          The ViewSwitcher itself owns the inversion — see its impl. */}
      <header className="mb-3 shrink-0">
        <DashboardHeader userEmail={user.email ?? ""} />
      </header>

      <div className="flex flex-1 min-h-0 flex-col overflow-y-auto overflow-x-hidden">
      {view === "day" && (
        <DayView
          startDate={date}
          todayStr={todayStr}
          timezone={profile.timezone ?? "UTC"}
          incompleteInfo={incompleteInfo}
          tagMap={tagMap}
          density={addActivityDensity}
          hiddenTags={hiddenTagsSet}
          timelineMode={timelineOn}
          untimedOpenDefault={untimedOpenDefault}
          chipsNode={
            <CalendarModifierChips
              currentView={view}
              timelineOn={timelineOn}
              allTagNames={Object.keys(tagMap).sort()}
              activeHiddenTags={activeHiddenTags}
            />
          }
        />
      )}
      {view === "week" && !timelineOn && (
        <WeekView
          weekDate={date}
          todayStr={todayStr}
          incompleteInfo={incompleteInfo}
          tagMap={tagMap}
          hiddenTags={hiddenTagsSet}
          chipsNode={
            <CalendarModifierChips
              currentView={view}
              timelineOn={timelineOn}
              allTagNames={Object.keys(tagMap).sort()}
              activeHiddenTags={activeHiddenTags}
            />
          }
        />
      )}
      {view === "week" && timelineOn && (
        <TimelineWeekView
          weekDate={date}
          todayStr={todayStr}
          tagMap={tagMap}
          hiddenTags={hiddenTagsSet}
          untimedOpenDefault={untimedOpenDefault}
          chipsNode={
            <CalendarModifierChips
              currentView={view}
              timelineOn={timelineOn}
              allTagNames={Object.keys(tagMap).sort()}
              activeHiddenTags={activeHiddenTags}
            />
          }
        />
      )}
      {view === "month" && (
        <MonthView
          monthDate={date}
          todayStr={todayStr}
          incompleteInfo={incompleteInfo}
          tagMap={tagMap}
          hiddenTags={hiddenTagsSet}
          chipsNode={
            <CalendarModifierChips
              currentView={view}
              timelineOn={timelineOn}
              allTagNames={Object.keys(tagMap).sort()}
              activeHiddenTags={activeHiddenTags}
            />
          }
        />
      )}
      {view === "year" && (
        <YearView
          yearDate={date}
          todayStr={todayStr}
          incompleteInfo={incompleteInfo}
          hiddenTags={hiddenTagsSet}
          chipsNode={
            <CalendarModifierChips
              currentView={view}
              timelineOn={timelineOn}
              allTagNames={Object.keys(tagMap).sort()}
              activeHiddenTags={activeHiddenTags}
            />
          }
        />
      )}
      {view === "grid" && (
        <GridView
          gridDate={date}
          todayStr={todayStr}
          range={range}
          customFrom={customFrom}
          customTo={customTo}
          userId={user.id}
          incompleteInfo={incompleteInfo}
          tagMap={tagMap}
        />
      )}
      </div>

      {/* Bottom-anchored view controls — section tabs / sub-tabs /
          modifier chips, all rendered "flipped": modifier chips first
          (top of the block), then sub-tabs, then section tabs at the
          very bottom just above the global BottomNav. ViewSwitcher
          also reverses each row's left-to-right order when the
          `bottomAnchored` prop is set. */}
      <div className="shrink-0 border-t border-zinc-200 bg-white pt-2 dark:border-zinc-800 dark:bg-zinc-950 pb-3">
        <ViewSwitcher
          section={view === "grid" ? "grid" : "calendar"}
          currentView={view}
          range={range}
          date={date}
          timelineOn={timelineOn}
          bottomAnchored
        />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Helpers for the day-view dropdown — drop completions that have been
// soft-deleted, and format a UTC timestamp as a YYYY-MM-DD in the user's
// timezone (so the bucket day matches what the user would have seen on
// their device when they tapped Complete).
// ---------------------------------------------------------------------------

type CompletionLink = {
  completion_id: string;
  completions: { occurred_at: string; deleted_at: string | null } | null;
};

function liveCompletions(
  links: CompletionLink[] | null
): Array<{ completion_id: string; occurred_at: string }> {
  if (!links) return [];
  const out: Array<{ completion_id: string; occurred_at: string }> = [];
  for (const link of links) {
    const c = link.completions;
    if (!c) continue;
    if (c.deleted_at) continue;
    out.push({ completion_id: link.completion_id, occurred_at: c.occurred_at });
  }
  return out;
}

function liveCompletionCount(links: CompletionLink[] | null): number {
  return liveCompletions(links).length;
}

function ymdInTimeZone(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

// ---------------------------------------------------------------------------
// fetchIncompleteInfo — used by every view's navigator to power the
// "Incomplete (N)" chip + jump-to-oldest behavior.
// ---------------------------------------------------------------------------

async function fetchIncompleteInfo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  todayStr: string
): Promise<IncompleteInfo> {
  // What counts as "unlabeled":
  //   - non-frequency: status='pending' AND scheduled_for < today
  //   - frequency:     status='pending' AND today >= periodEnd
  //                    (i.e. the WHOLE period has closed without the
  //                     user hitting the goal). A still-open period
  //                     never counts — the user still has time.
  //
  // SQL can do the cheap lower-bound (scheduled_for < today) — anything
  // newer can't possibly be past-due. The frequency-specific second
  // condition needs the rhythm, so we fetch rows + rhythms and filter
  // in JS. The window of past-pending instances is small per user
  // (typically O(10s)) so we accept the row-level fetch in exchange
  // for the rule fix.
  //
  // Two-step pattern (rather than a single nested-FK query): PostgREST's
  // count semantics when an inner-join filter is layered on a head-only
  // query were undercounting in practice — see git history. Two simple
  // queries cost a tiny extra round-trip but are reliable.
  const { data: activeRows } = await supabase
    .from("activities")
    .select("id, rhythm")
    .is("archived_at", null);

  const active = (activeRows ?? []) as Array<{ id: string; rhythm: Rhythm }>;
  if (active.length === 0) return { count: 0, oldestDate: null };

  const rhythmById = new Map(active.map((a) => [a.id, a.rhythm] as const));
  const ids = active.map((a) => a.id);

  const { data: pendingRows } = await supabase
    .from("activity_instances")
    .select("activity_id, scheduled_for")
    .in("activity_id", ids)
    .eq("status", "pending")
    .lt("scheduled_for", todayStr)
    .order("scheduled_for", { ascending: true });

  const rows = (pendingRows ?? []) as Array<{
    activity_id: string;
    scheduled_for: string;
  }>;

  // Filter in JS using the rhythm-aware rule. For frequency, the row's
  // landing day (where the chip should JUMP) is the period's due day,
  // not scheduled_for. For everything else it's scheduled_for.
  type Past = { landingDay: string };
  const past: Past[] = [];
  for (const r of rows) {
    const rh = rhythmById.get(r.activity_id);
    if (!rh) continue;
    if (!isPastDuePending(r.scheduled_for, rh, todayStr)) continue;
    past.push({ landingDay: unlabeledLandingDay(r.scheduled_for, rh) });
  }

  if (past.length === 0) return { count: 0, oldestDate: null };

  // Oldest landing day → where the "jump to oldest" chip routes the
  // user. `visibleOnDay` is guaranteed to render the row on that day,
  // so the section will be non-empty when they land.
  let oldest = past[0].landingDay;
  for (const p of past) if (p.landingDay < oldest) oldest = p.landingDay;
  return { count: past.length, oldestDate: oldest };
}

// ---------------------------------------------------------------------------

function parseView(raw: string | undefined): ViewKind {
  if (
    raw === "month" ||
    raw === "week" ||
    raw === "year" ||
    raw === "grid"
  ) {
    return raw;
  }
  // Legacy "?view=timeline" from before the toggle refactor still resolves
  // to the Day view — page.tsx pairs it with `timeline=1` in the caller
  // so the timeline overlay renders.
  if (raw === "timeline") return "day";
  return "day";
}

// True when the URL asks for the Timeline visualization. Only meaningful
// when the current view is "day" for now (Week/Month/Year timeline
// variants are not built yet).
function parseTimelineFlag(
  rawView: string | undefined,
  rawTimeline: string | undefined
): boolean {
  if (rawView === "timeline") return true;
  return rawTimeline === "1" || rawTimeline === "true";
}

function parseGridRange(
  raw: string | undefined,
  fallback: GridRange = "week"
): GridRange {
  if (raw === "week") return "week";
  if (raw === "month") return "month";
  if (raw === "total") return "total";
  if (raw === "custom") return "custom";
  return fallback;
}

function parseDateParam(raw: string | undefined, todayStr: string): string {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return todayStr;
  const d = parseISO(raw);
  if (Number.isNaN(d.getTime())) return todayStr;
  return raw;
}

// Same shape but returns null on missing/invalid. Used for the
// optional ?from / ?to params on the Custom grid range.
function parseOptionalDateParam(raw: string | undefined): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = parseISO(raw);
  if (Number.isNaN(d.getTime())) return null;
  return raw;
}

function parseDate(yyyyMmDd: string): Date {
  // LOCAL midnight (not UTC). This keeps addDays / format / startOfWeek
  // from drifting by one day in non-UTC time zones, which was breaking
  // the forward/back arrows on every view.
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ---------------------------------------------------------------------------

function SignedOutLanding() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col justify-center gap-8 p-6">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">Mission</h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Accomplish your mission.
        </p>
      </header>
      <section className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/login"
          className="rounded-md bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Log in
        </Link>
        <Link
          href="/signup"
          className="rounded-md border border-zinc-300 px-4 py-2 text-center text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Sign up
        </Link>
      </section>
    </main>
  );
}

// Two-level view switcher:
//   Row 1: section tabs       [Calendar] [Grid]
//   Row 2: sub-tabs            [Day][Week][Month][Year]   when Calendar
//                              [Week][Month][Total]        when Grid
// The two-level layout means "what AM I looking at" splits cleanly into
// "what KIND of view" + "what slice of time," instead of cramming all
// five buttons onto one row.
function ViewSwitcher({
  section,
  currentView,
  range,
  date,
  timelineOn,
  bottomAnchored = false,
}: {
  section: Section;
  currentView: ViewKind;
  range: GridRange;
  date: string;
  timelineOn: boolean;
  /** When true, render as a bottom-anchored control strip: the row
   *  order and each row's inner order are reversed (per user spec:
   *  "invert them bottom to top and left to right"). Left-to-right
   *  reversal is done with `flex-row-reverse` so the visual order
   *  flips but tab order + click semantics stay the same. */
  bottomAnchored?: boolean;
}) {
  const flipRow = bottomAnchored ? "flex-row-reverse" : "";
  // flex-col-reverse renders children BOTTOM to TOP. Combined with
  // per-row flip above, the whole block reads inverted both axes.
  const outerCol = bottomAnchored
    ? "flex flex-col-reverse gap-1"
    : "flex flex-col gap-1";
  return (
    <div className={outerCol}>
      {/* Section tabs (Calendar / Streaks / Total View) — shared with
          the Total View page via SectionTabs. In bottom-anchored mode
          this row ends up VISUALLY at the very bottom of the block
          (because of flex-col-reverse above) and its inner items also
          flip via `flipRow`. */}
      <SectionTabs active={section} date={date} />

      {/* Sub-tabs row + calendar's modifier chips. flipRow reverses
          Day/Week/Month/Year visually when bottom-anchored. */}
      {section === "calendar" ? (
        <nav
          className={`flex gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800 ${flipRow}`}
          aria-label="Calendar view"
        >
          {CALENDAR_SUB_OPTIONS.map((opt) => (
            <SubTab
              key={opt.value}
              label={opt.label}
              href={`/?view=${opt.value}&date=${date}${
                timelineOn ? "&timeline=1" : ""
              }`}
              active={opt.value === currentView}
            />
          ))}
        </nav>
      ) : (
        <nav
          className={`flex gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800 ${flipRow}`}
          aria-label="Streaks range"
        >
          {GRID_SUB_OPTIONS.map((opt) => (
            <SubTab
              key={opt.value}
              label={opt.label}
              href={`/?view=grid&range=${opt.value}&date=${date}`}
              active={opt.value === range}
            />
          ))}
        </nav>
      )}
    </div>
  );
}

// StickyNav — wrapper that pins each view's date navigator just below
// the page-level ViewSwitcher (which sticks at top-0).
//
// Measured ViewSwitcher height after the tightened spacing: ~80px
// (section row ~34 + gap-1 4 + sub row ~26 + py-2 16). Setting the
// Navigator at `top-[5rem]` (80px) makes the two abut exactly. If
// either nav row's vertical padding changes, retune these together.
//
// No negative horizontal margin: the scroll container this sticks in
// (the app-shell scroll region) already spans exactly the content
// width, and the page's px-6 gutter lives OUTSIDE it, so a `-mx-6`
// bleed only made this header 48px wider than the container — which
// forced a horizontal scrollbar on Week view. Full-width bg (no
// -mx-6 / px-6) covers the scrolled content just fine.
function StickyNav({ children }: { children: React.ReactNode }) {
  // top-0 (was top-[5rem]) since the app-shell refactor moved the
  // DashboardHeader OUT of the scroll container. The sticky nav now
  // sits at the top of its own scroll region — a 5rem offset was
  // leaving the nav parked mid-page and covering the top row of
  // Week view banners.
  return (
    <div className="sticky top-0 z-20 bg-white py-2 dark:bg-zinc-950">
      {children}
    </div>
  );
}

function SubTab({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      // py tightened from py-1 → py-0.5.
      className={`flex flex-1 items-center justify-center rounded px-3 py-0.5 text-center text-xs font-medium transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
      }`}
    >
      {label}
      <TabPending />
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Day view — target date + the next 6 days stacked. Scroll for more.
// ---------------------------------------------------------------------------

async function DayView({
  startDate,
  todayStr,
  timezone,
  incompleteInfo,
  tagMap,
  density,
  hiddenTags,
  chipsNode,
  timelineMode = false,
  untimedOpenDefault = false,
}: {
  startDate: string;
  todayStr: string;
  timezone: string;
  incompleteInfo: IncompleteInfo;
  tagMap: TagMap;
  density: AddActivityDensity;
  hiddenTags: ReadonlySet<string>;
  chipsNode?: React.ReactNode;
  /** Timeline overlay on/off. Same fetch either way — DayList swaps
   *  the per-day middle render (hour grid for timed pending + row
   *  list for untimed) via its own `timelineMode` prop. */
  timelineMode?: boolean;
  /** Default open/collapsed state for the per-day untimed dropdown
   *  inside Timeline mode (migration 0037). */
  untimedOpenDefault?: boolean;
}) {
  const supabase = await createClient();

  const startD = parseDate(startDate);
  const windowStartD = addDays(startD, -DAY_VIEW_BACK);
  const windowEndD = addDays(startD, DAY_VIEW_AHEAD);
  const windowStartStr = format(windowStartD, "yyyy-MM-dd");
  const windowEndStr = format(windowEndD, "yyyy-MM-dd");

  // ONE query fetches every instance in the window (pending + completed
  // + missed), with the full activity payload + completion-count needed
  // for the modal. We bucket by status on the client. This replaces the
  // older two-query split (one for pending, one for completions joined
  // back to instances).
  //
  // Dropdown bucketing:
  //   - Non-frequency: keyed by scheduled_for. A user who completes
  //     Tuesday's gym on Saturday wants Tuesday's row to STAY on
  //     Tuesday's banner — they're documenting what they did for that
  //     scheduled day. Using occurred_at made it leap to Saturday,
  //     which looked like the past had silently changed.
  //   - Frequency ("N×/period"): keyed by each completion's date in
  //     the user's timezone. Frequency rhythms have no "this is what I
  //     did on Tuesday" — the user can complete it any time inside the
  //     period, and the dropdown should land on the day they actually
  //     did it. Multiple completions = multiple dropdown rows. Missed
  //     frequency lands on the period's due day (the last day inside
  //     the window) as a single "missed" dropdown entry.
  const { data } = await supabase
    .from("activity_instances")
    .select(
      `
      id,
      scheduled_for,
      status,
      tags,
      name,
      notes,
      priority,
      comment,
      activities (
        id,
        name,
        notes,
        rhythm,
        priority,
        scheduled_times,
        scheduled_end_times,
        default_skill_tags,
        start_date,
        end_date,
        archived_at,
        reminders,
        track_on_grid,
        rollover_missed_days,
        rollover_change_rhythm,
        auto_archive
      ),
      completion_instances (
        completion_id,
        completions ( occurred_at, deleted_at )
      )
    `
    )
    .gte("scheduled_for", windowStartStr)
    .lte("scheduled_for", windowEndStr)
    .order("scheduled_for");

  type RawCompletionLink = {
    completion_id: string;
    completions: { occurred_at: string; deleted_at: string | null } | null;
  };
  type RawInstance = {
    id: string;
    scheduled_for: string;
    status: string;
    tags: string[] | null;
    // Per-occurrence overrides (instance's own columns, NOT the joined
    // activity's). NULL = inherit from the activity.
    name: string | null;
    notes: string | null;
    priority: number | null;
    comment: string | null;
    activities: DayInstance["activity"] | null;
    completion_instances: RawCompletionLink[] | null;
  };
  const raw = (data ?? []) as unknown as RawInstance[];
  const live = raw.filter(
    (r): r is RawInstance & { activities: DayInstance["activity"] } => {
      if (!r.activities) return false;
      if (r.activities.archived_at) return false;
      if (!keepForCalendar(r.activities.default_skill_tags ?? [], hiddenTags))
        return false;
      return true;
    }
  );

  const toInstance = (r: RawInstance & { activities: DayInstance["activity"] }): DayInstance => ({
    id: r.id,
    scheduled_for: r.scheduled_for,
    status:
      r.status === "completed" || r.status === "missed"
        ? r.status
        : "pending",
    tags: r.tags ?? [],
    overrideName: r.name ?? null,
    overrideNotes: r.notes ?? null,
    overridePriority: r.priority ?? null,
    comment: r.comment ?? null,
    activity: r.activities,
    completionCount: liveCompletionCount(r.completion_instances),
  });

  // Pending instances → the active list. Completed/missed → the dropdown.
  // (For a partially-completed frequency the row stays pending in the
  // active list AND each completion shows up in its day's dropdown.)
  const instances: DayInstance[] = live
    .filter((r) => r.status === "pending")
    .map(toInstance);

  const completedByDate: Record<string, DayMarkedItem[]> = {};
  const missedByDate: Record<string, DayMarkedItem[]> = {};
  for (const r of live) {
    const isFrequency = r.activities.rhythm.type === "frequency";

    if (isFrequency) {
      // For frequency we emit ONE dropdown row per live completion,
      // keyed by date(occurred_at) in the user's TZ. That holds even if
      // the instance is still pending (partial progress) — each
      // completion is still a real "I did this on day X" event worth
      // showing in that day's dropdown. The completed-status flag on
      // the instance carries no extra info beyond "the completions
      // hit the goal," which is implicit from the per-completion rows.
      const completions = liveCompletions(r.completion_instances);
      for (const c of completions) {
        const day = ymdInTimeZone(c.occurred_at, timezone);
        (completedByDate[day] ??= []).push({
          id: `${r.id}:${c.completion_id}`,
          instanceId: r.id,
          instance: toInstance(r),
          // Inline Unlabel wipes ALL completions on this instance — hide
          // it on per-completion rows so users don't accidentally undo
          // their other progress. The modal still offers fine-grained
          // controls.
          hideInlineUnlabel: true,
        });
      }
      if (r.status === "missed") {
        // No "missed_at" column — and "missed" for a frequency means
        // "user gave up on this period." Land it on the period's last
        // day (the row's natural Unlabeled slot), which keeps it close
        // to where the user would have found it pending.
        const dueDay = frequencyDueDay(r.scheduled_for, r.activities.rhythm);
        (missedByDate[dueDay] ??= []).push({
          id: r.id,
          instanceId: r.id,
          instance: toInstance(r),
        });
      }
      continue;
    }

    // Non-frequency: one dropdown row per instance, on its scheduled_for.
    if (r.status === "completed") {
      (completedByDate[r.scheduled_for] ??= []).push({
        id: r.id,
        instanceId: r.id,
        instance: toInstance(r),
      });
    } else if (r.status === "missed") {
      (missedByDate[r.scheduled_for] ??= []).push({
        id: r.id,
        instanceId: r.id,
        instance: toInstance(r),
      });
    }
  }

  // Only fetch the ack set when timeline is on; wasted round-trip
  // otherwise (non-timeline mode ignores it).
  const acknowledgedPairKeys = timelineMode
    ? await listAcknowledgedPairKeys()
    : [];

  return (
    <DayList
      // No `key` here on purpose: reconciling across the Timeline
      // toggle is what keeps the transition snappy on desktop and
      // avoids tearing down / rebuilding 271 DaySections (the
      // "flash" the user reported after the earlier iOS fix).
      // DayList's initial-scroll useLayoutEffect now depends on
      // BOTH `initialDate` and `timelineMode`, so it explicitly
      // resets scrollTop and re-anchors to `initialDate` when the
      // mode flips — no remount needed to get the same guarantee.
      initialDate={startDate}
      instances={instances}
      completedByDate={completedByDate}
      missedByDate={missedByDate}
      todayStr={todayStr}
      incompleteInfo={incompleteInfo}
      tagMap={tagMap}
      density={density}
      chipsSlot={chipsNode}
      timelineMode={timelineMode}
      untimedOpenDefault={untimedOpenDefault}
      acknowledgedPairKeys={acknowledgedPairKeys}
      fillHeight
    />
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Timeline (Week) — 7 side-by-side day columns, each a mini vertical
// hour grid. Fetches instances across the whole visible week and hands
// them to the client TimelineWeek component to render + own the
// ActivityModal + overlap layout.
// ---------------------------------------------------------------------------

async function TimelineWeekView({
  weekDate,
  todayStr,
  tagMap,
  hiddenTags,
  chipsNode,
  untimedOpenDefault = false,
}: {
  weekDate: string;
  todayStr: string;
  tagMap: TagMap;
  hiddenTags: ReadonlySet<string>;
  chipsNode?: React.ReactNode;
  untimedOpenDefault?: boolean;
}) {
  const supabase = await createClient();

  const refDate = parseDate(weekDate);
  const weekStart = startOfWeek(refDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(refDate, { weekStartsOn: 1 });
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");
  const weekDates = Array.from({ length: 7 }, (_, i) =>
    format(addDays(weekStart, i), "yyyy-MM-dd")
  );

  // Fetch the same shape DayView uses, scoped to the week window,
  // so TimelineWeek can pass full DayInstances to the ActivityModal.
  const { data } = await supabase
    .from("activity_instances")
    .select(
      `
      id,
      scheduled_for,
      status,
      tags,
      name,
      notes,
      priority,
      comment,
      activities (
        id,
        name,
        notes,
        rhythm,
        priority,
        scheduled_times,
        scheduled_end_times,
        default_skill_tags,
        start_date,
        end_date,
        archived_at,
        reminders,
        track_on_grid,
        rollover_missed_days,
        rollover_change_rhythm,
        auto_archive
      ),
      completion_instances (
        completion_id,
        completions ( occurred_at, deleted_at )
      )
    `
    )
    .gte("scheduled_for", weekStartStr)
    .lte("scheduled_for", weekEndStr);

  type Row = {
    id: string;
    scheduled_for: string;
    status: string;
    tags: string[] | null;
    name: string | null;
    notes: string | null;
    priority: number | null;
    comment: string | null;
    activities: DayInstance["activity"] | null;
    completion_instances: Array<{
      completion_id: string;
      completions: { occurred_at: string; deleted_at: string | null } | null;
    }> | null;
  };

  const rows = ((data ?? []) as unknown as Row[]).filter(
    (r): r is Row & { activities: DayInstance["activity"] } => {
      if (!r.activities) return false;
      if (r.activities.archived_at) return false;
      if (!keepForCalendar(r.activities.default_skill_tags ?? [], hiddenTags))
        return false;
      return true;
    }
  );

  const instances: DayInstance[] = rows.map((r) => ({
    id: r.id,
    scheduled_for: r.scheduled_for,
    status:
      r.status === "completed" || r.status === "missed" ? r.status : "pending",
    tags: r.tags ?? [],
    overrideName: r.name ?? null,
    overrideNotes: r.notes ?? null,
    overridePriority: r.priority ?? null,
    comment: r.comment ?? null,
    activity: r.activities,
    completionCount: liveCompletionCount(r.completion_instances),
  }));

  return (
    <TimelineWeek
      weekDates={weekDates}
      todayStr={todayStr}
      instances={instances}
      tagMap={tagMap}
      chipsSlot={chipsNode}
      untimedOpenDefault={untimedOpenDefault}
    />
  );
}

// ---------------------------------------------------------------------------
// Week view — 7 columns. Each column = a Link to that day's Day view.
// Banners inside each column show that day's activities.
// ---------------------------------------------------------------------------

async function WeekView({
  weekDate,
  todayStr,
  incompleteInfo,
  tagMap,
  hiddenTags,
  chipsNode,
}: {
  weekDate: string;
  todayStr: string;
  incompleteInfo: IncompleteInfo;
  tagMap: TagMap;
  hiddenTags: ReadonlySet<string>;
  chipsNode?: React.ReactNode;
}) {
  const supabase = await createClient();

  const refDate = parseDate(weekDate);
  const weekStart = startOfWeek(refDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(refDate, { weekStartsOn: 1 });
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  const { data } = await supabase
    .from("activity_instances")
    .select(
      `
      id,
      scheduled_for,
      status,
      tags,
      activities (
        id, name, rhythm, priority, scheduled_times, default_skill_tags, archived_at
      )
    `
    )
    .gte("scheduled_for", weekStartStr)
    .lte("scheduled_for", weekEndStr);

  type WeekInstance = {
    id: string;
    scheduled_for: string;
    status: string;
    /** Per-instance tag snapshot. We pass these (not the activity's
     *  current tags) into WeekBanner so a tag change via Edit Activity
     *  doesn't retroactively reshuffle the dots on past banners. */
    tags: string[] | null;
    activities: {
      id: string;
      name: string;
      rhythm: Rhythm;
      priority: number;
      scheduled_times: string[];
      default_skill_tags: string[];
      archived_at: string | null;
    } | null;
  };

  const all = (data ?? []) as unknown as WeekInstance[];
  const byDate: Record<string, WeekInstance[]> = {};
  for (const i of all) {
    if (!i.activities || i.activities.archived_at) continue;
    if (
      !keepForCalendar(i.activities.default_skill_tags ?? [], hiddenTags)
    )
      continue;
    (byDate[i.scheduled_for] ??= []).push(i);
  }
  for (const list of Object.values(byDate)) {
    list.sort((a, b) => {
      // Primary: time of day (08:00 before 10:00 before 13:00). Activities
      // with NO set time sort last ("99:99" sentinel). Then pending before
      // done, then priority, then name.
      const ta = a.activities?.scheduled_times?.[0] ?? "99:99";
      const tb = b.activities?.scheduled_times?.[0] ?? "99:99";
      if (ta !== tb) return ta.localeCompare(tb);
      if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
      const pa = a.activities?.priority ?? 2;
      const pb = b.activities?.priority ?? 2;
      if (pa !== pb) return pa - pb;
      return (a.activities?.name ?? "").localeCompare(b.activities?.name ?? "");
    });
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const dateStr = format(date, "yyyy-MM-dd");
    return {
      date,
      dateStr,
      isToday: dateStr === todayStr,
      items: byDate[dateStr] ?? [],
    };
  });

  const prevDate = format(addDays(weekStart, -7), "yyyy-MM-dd");
  const nextDate = format(addDays(weekStart, 7), "yyyy-MM-dd");

  return (
    <div className="flex flex-col gap-3">
      <StickyNav>
        <DateNavigator
          view="week"
          currentDate={weekDate}
          prevDate={prevDate}
          nextDate={nextDate}
          label={`${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`}
          incompleteInfo={incompleteInfo}
          chipsSlot={chipsNode}
        />
      </StickyNav>

      {/* Same 7-column grid on every viewport. Cells are intentionally
          compact (p-1, gap-1, tiny banner text) so that on a narrow
          viewport (phone width ≈ 320–430px) each cell still fits ~5+
          characters of activity name per line of the banner. */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => (
          <Link
            key={d.dateStr}
            href={`/?view=day&date=${d.dateStr}`}
            className={`flex min-h-[7rem] min-w-0 touch-manipulation flex-col gap-1 rounded-md border p-1 transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:hover:bg-zinc-900 dark:active:bg-zinc-800 ${
              d.isToday
                ? "border-zinc-900 dark:border-zinc-50"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <div className="text-center">
              <div className="text-[9px] font-medium uppercase tracking-wide text-zinc-500">
                {format(d.date, "EEE")}
              </div>
              <div className={`text-sm ${d.isToday ? "font-semibold" : "text-zinc-700 dark:text-zinc-300"}`}>
                {d.date.getDate()}
              </div>
            </div>
            {d.items.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-[9px] text-zinc-300 dark:text-zinc-700">
                —
              </div>
            ) : (
              <ul className="flex min-w-0 flex-col gap-0.5">
                {d.items.map((i) => (
                  <WeekBanner key={i.id} item={i} tagMap={tagMap} />
                ))}
              </ul>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}

function WeekBanner({
  item,
  tagMap,
}: {
  item: {
    status: string;
    /** Snapshotted per-instance tags. The week-view dots read this
     *  rather than the activity's current set so editing the
     *  activity's tags doesn't change past banners. */
    tags?: string[] | null;
    activities: {
      name: string;
      priority: number;
      scheduled_times: string[];
    } | null;
  };
  tagMap: TagMap;
}) {
  if (!item.activities) return null;
  const isCompleted = item.status === "completed";
  // Priority dot removed per user spec (soft removal — the column
  // stays, nothing UI-facing reads it right now).
  const firstTime = item.activities.scheduled_times?.[0];
  const tagNames = item.tags ?? [];

  return (
    <li
      className={`flex min-w-0 items-start gap-0.5 overflow-hidden rounded px-1 py-0.5 text-[9px] leading-tight ${
        isCompleted
          ? "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-900 dark:text-zinc-600"
          : "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
      }`}
      title={`${item.activities.name}${firstTime ? ` @ ${firstTime}` : ""}${
        tagNames.length > 0 ? ` · ${tagNames.join(", ")}` : ""
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block line-clamp-2 break-words font-medium">
          {item.activities.name}
        </span>
        {firstTime && <span className="block opacity-75">{firstTime}</span>}
        {tagNames.length > 0 && (
          <TagDotRow
            names={tagNames}
            tags={tagMap}
            dotClassName="h-1 w-1"
            max={4}
          />
        )}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Month view — calendar grid with per-day counts. Each cell is a Link to
// that day's Day view. Out-of-month cells are also clickable (jump to that
// day in its native month).
// ---------------------------------------------------------------------------

async function MonthView({
  monthDate,
  todayStr,
  incompleteInfo,
  tagMap,
  hiddenTags,
  chipsNode,
}: {
  monthDate: string;
  todayStr: string;
  incompleteInfo: IncompleteInfo;
  tagMap: TagMap;
  hiddenTags: ReadonlySet<string>;
  chipsNode?: React.ReactNode;
}) {
  const supabase = await createClient();

  // Endless-scroll Month is a client component (MonthList). The server
  // eagerly fetches the initial window (±MONTH_INITIAL_RADIUS months
  // around the URL's month) so first paint is fully populated without
  // waiting on a client fetch. Further-out months lazy-load on scroll.
  const refDate = parseDate(monthDate);
  const initialMonthKey = format(startOfMonth(refDate), "yyyy-MM-01");

  // Compute the eager fetch window: grid-start of (month − radius)
  // through grid-end of (month + radius). One SQL query covers the
  // whole span.
  const windowMonths: string[] = [];
  for (
    let i = -MONTH_INITIAL_RADIUS;
    i <= MONTH_INITIAL_RADIUS;
    i++
  ) {
    windowMonths.push(
      format(startOfMonth(addMonths(refDate, i)), "yyyy-MM-01")
    );
  }
  const firstMonthStart = parseDate(windowMonths[0]);
  const lastMonthStart = parseDate(windowMonths[windowMonths.length - 1]);
  const eagerFrom = startOfWeek(firstMonthStart, { weekStartsOn: 1 });
  const eagerTo = addDays(startOfWeek(lastMonthStart, { weekStartsOn: 1 }), 41);

  const { data } = await supabase
    .from("activity_instances")
    .select(
      "id, scheduled_for, status, tags, activities!inner(name, archived_at, default_skill_tags)"
    )
    .gte("scheduled_for", format(eagerFrom, "yyyy-MM-dd"))
    .lte("scheduled_for", format(eagerTo, "yyyy-MM-dd"))
    .is("activities.archived_at", null);

  type Row = {
    id: string;
    scheduled_for: string;
    status: string;
    tags: string[] | null;
    activities:
      | { name: string; archived_at: string | null; default_skill_tags: string[] | null }
      | Array<{ name: string; archived_at: string | null; default_skill_tags: string[] | null }>
      | null;
  };
  // Flat byDate map (from eager fetch), then re-bucket by monthKey to
  // match the shape MonthList expects (Record<monthKey, MonthBannersByDate>).
  const flat: Record<string, MonthBanner[]> = {};
  for (const r of (data ?? []) as Row[]) {
    const act = Array.isArray(r.activities) ? r.activities[0] : r.activities;
    if (!act) continue;
    if (!keepForCalendar(act.default_skill_tags ?? [], hiddenTags)) continue;
    (flat[r.scheduled_for] ??= []).push({
      id: r.id,
      name: act.name,
      status: r.status,
      tags: r.tags ?? [],
    });
  }
  const initialData: Record<string, MonthBannersByDate> = {};
  for (const key of windowMonths) {
    const monthStart = parseDate(key);
    const monthEnd = endOfMonth(monthStart);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = addDays(gridStart, 41);
    const byDate: MonthBannersByDate = {};
    for (let d = 0; d < 42; d++) {
      const dt = addDays(gridStart, d);
      if (dt < gridStart || dt > gridEnd) continue;
      const ds = format(dt, "yyyy-MM-dd");
      if (flat[ds]) byDate[ds] = flat[ds];
    }
    initialData[key] = byDate;
  }

  // No StickyNav wrapper here (unlike Week): MonthList fills the outer
  // scroll region itself — its header is a shrink-0 flex row and only its
  // inner month body scrolls. Wrapping it in a fixed-height sticky block
  // was what made the whole view overflow the page and scroll the date /
  // "‹ YYYY" controls off the top.
  return (
    <MonthList
      initialMonth={initialMonthKey}
      initialData={initialData}
      todayStr={todayStr}
      incompleteInfo={incompleteInfo}
      tagMap={tagMap}
      hiddenTags={Array.from(hiddenTags)}
      chipsSlot={chipsNode}
    />
  );
}

// ---------------------------------------------------------------------------
// Year view — 12 mini-month calendars in a 3-column grid, iPhone-Calendar
// style. Each month is clickable → jumps to Month view for that month.
// Days with activity are filled; today is ringed.
// ---------------------------------------------------------------------------

async function YearView({
  yearDate,
  todayStr,
  incompleteInfo,
  hiddenTags,
  chipsNode,
}: {
  yearDate: string;
  todayStr: string;
  incompleteInfo: IncompleteInfo;
  hiddenTags: ReadonlySet<string>;
  chipsNode?: React.ReactNode;
}) {
  const supabase = await createClient();
  const refYear = Number(yearDate.slice(0, 4));
  const initialYearKey = `${refYear}-01-01`;

  // Server-eagerly load the initial window (±YEAR_INITIAL_RADIUS). The
  // rest lazy-loads on scroll via fetchYearActivities from the client.
  const eagerYears: number[] = [];
  for (
    let i = -YEAR_INITIAL_RADIUS;
    i <= YEAR_INITIAL_RADIUS;
    i++
  ) {
    eagerYears.push(refYear + i);
  }
  const eagerFrom = `${eagerYears[0]}-01-01`;
  const eagerTo = `${eagerYears[eagerYears.length - 1]}-12-31`;

  const { data } = await supabase
    .from("activity_instances")
    .select(
      "scheduled_for, status, activities!inner(archived_at, default_skill_tags)"
    )
    .gte("scheduled_for", eagerFrom)
    .lte("scheduled_for", eagerTo)
    .is("activities.archived_at", null);

  type YearRow = {
    scheduled_for: string;
    status: string;
    activities:
      | { default_skill_tags: string[] | null }
      | Array<{ default_skill_tags: string[] | null }>
      | null;
  };
  const initialData: Record<string, YearCountsByDate> = {};
  for (const y of eagerYears) initialData[`${y}-01-01`] = {};
  for (const r of (data ?? []) as YearRow[]) {
    const act = Array.isArray(r.activities) ? r.activities[0] : r.activities;
    if (!act) continue;
    if (!keepForCalendar(act.default_skill_tags ?? [], hiddenTags)) continue;
    const yearKey = `${r.scheduled_for.slice(0, 4)}-01-01`;
    const bucket = initialData[yearKey];
    if (!bucket) continue;
    const c = (bucket[r.scheduled_for] ??= { pending: 0, completed: 0 });
    if (r.status === "pending") c.pending += 1;
    else if (r.status === "completed") c.completed += 1;
  }

  // No StickyNav wrapper (see MonthView) — YearList fills the outer
  // scroll region and only its inner year body scrolls.
  return (
    <YearList
      initialYear={initialYearKey}
      initialData={initialData}
      todayStr={todayStr}
      incompleteInfo={incompleteInfo}
      hiddenTags={Array.from(hiddenTags)}
      chipsSlot={chipsNode}
    />
  );
}

// ---------------------------------------------------------------------------
// Grid view — habit-tracker matrix.
//
// Two range modes:
//   - week/month: classic grid (rows = activities, cols = days). Each
//     cell is a clickable button that opens the ActivityModal in place.
//   - total:     all-time summary (rows = activities, fixed columns
//     for done/missed/overdue/success %, no per-day cells).
//
// Singles (one-time events) are excluded from the rhythm grid by
// design — a single event would be a one-cell row with no recurrence
// to track. Instead we surface them as a count banner below the grid
// ("You have also completed X/Y one-time events this week/month/...").
//
// Cell coloring (calendar mode, per (activity, date) cell):
//   completed       — solid green, ✓
//   missed          — solid red, ✗
//   overdue         — amber !  (past pending: neither done nor marked)
//   scheduled       — light grey box ·  (today/future still on the menu)
//   not-scheduled   — blank (rhythm doesn't apply)
//   outside-active  — diagonal-hatch (activity wasn't active this day)
//
// Success % = completed / (completed + missed + overdue). Future-
// scheduled days don't drag the score down because the user hasn't
// had a chance to do them yet.
// ---------------------------------------------------------------------------

async function GridView({
  gridDate,
  todayStr,
  range,
  customFrom,
  customTo,
  userId,
  incompleteInfo,
  tagMap,
}: {
  gridDate: string;
  todayStr: string;
  range: GridRange;
  /** Custom-range start. Only consulted when range==="custom". null
   *  defaults to today - CUSTOM_DEFAULT_DAYS. */
  customFrom: string | null;
  /** Custom-range end. Only consulted when range==="custom". null
   *  defaults to today. */
  customTo: string | null;
  userId: string;
  incompleteInfo: IncompleteInfo;
  tagMap: TagMap;
}) {
  const supabase = await createClient();
  const refDate = parseDate(gridDate);

  // ---- 1. Fetch ALL non-archived activities (need start_date BEFORE we
  // compute Total's range, since Total spans from the earliest activity
  // start to today) + the user's streak display settings ------------------
  const [{ data: activitiesRaw }, { data: streakProfile }] = await Promise.all([
    supabase
      .from("activities")
      .select(
        "id, name, notes, rhythm, priority, scheduled_times, scheduled_end_times, default_skill_tags, start_date, end_date, archived_at, reminders, streak_mode, streak_goal, track_on_grid, rollover_missed_days, rollover_change_rhythm"
      )
      .eq("user_id", userId)
      .is("archived_at", null)
      .order("name"),
    supabase
      .from("profiles")
      .select(
        "streak_scope, streak_mode, streak_stats, streak_stats_accuracy, streak_goal"
      )
      .eq("id", userId)
      .maybeSingle(),
  ]);

  type ActivityRow = {
    id: string;
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    priority: number;
    scheduled_times: string[];
    scheduled_end_times: string[];
    default_skill_tags: string[];
    start_date: string;
    end_date: string | null;
    archived_at: string | null;
    reminders: Array<{ amount: number; unit: string }>;
    streak_mode: string | null;
    streak_goal: number | null;
    track_on_grid: boolean;
    rollover_missed_days: boolean;
    rollover_change_rhythm: boolean;
  };
  // Grid only DISPLAYS activities the user opted into (track_on_grid).
  // Everything is still tracked elsewhere; this is a display filter.
  const activities = (
    (activitiesRaw ?? []) as ActivityRow[]
  ).filter((a) => a.track_on_grid);

  // Streak display config (Settings → Streaks). scope 'same' → globalMode
  // for every activity; 'independent' → each activity's own mode (falling
  // back to globalMode when unset).
  const sp = (streakProfile ?? {}) as {
    streak_scope?: string;
    streak_mode?: string;
    streak_stats?: boolean;
    streak_stats_accuracy?: boolean;
    streak_goal?: number | null;
  };
  const streakScope = sp.streak_scope === "independent" ? "independent" : "same";
  const globalStreakMode: StreakMode = isStreakMode(sp.streak_mode)
    ? sp.streak_mode
    : "none";
  const globalStreakGoal = sp.streak_goal ?? null;
  const showStats = sp.streak_stats ?? true;
  const statsAccuracy = sp.streak_stats_accuracy ?? true;

  // ---- 2. Range bounds ---------------------------------------------------
  // Total = first rhythmic activity's start_date → today. NOT a fixed
  // 365-day window — if the user has only been at this for two weeks,
  // Total shows two weeks. If they've been at it for years, Total
  // shows years. The heatmap layout (7-row, week-aligned, column-
  // major flow) keeps the rendered width bounded regardless.
  const rhythmicForRange = activities.filter((a) => a.rhythm.type !== "single");
  const earliestStartStr =
    rhythmicForRange.length === 0
      ? todayStr
      : rhythmicForRange.reduce(
          (min, a) => (a.start_date < min ? a.start_date : min),
          "9999-12-31"
        );

  // Custom-range bounds. Defaults: end = today, start = today - 30d.
  // If the user supplied `from` later than `to`, we swap so the
  // resulting interval is still valid (charitable parsing — saves a
  // round-trip if they typo'd the order).
  let customStart: Date;
  let customEnd: Date;
  if (range === "custom") {
    const today = parseDate(todayStr);
    customEnd = customTo ? parseDate(customTo) : today;
    customStart = customFrom
      ? parseDate(customFrom)
      : addDays(customEnd, -CUSTOM_DEFAULT_DAYS);
    if (customStart > customEnd) {
      const tmp = customStart;
      customStart = customEnd;
      customEnd = tmp;
    }
  } else {
    customStart = parseDate(todayStr);
    customEnd = customStart;
  }

  const rangeStart: Date =
    range === "week"
      ? startOfWeek(refDate, { weekStartsOn: 1 })
      : range === "month"
        ? startOfMonth(refDate)
        : range === "custom"
          ? customStart
          : parseDate(earliestStartStr);
  const rangeEnd: Date =
    range === "week"
      ? endOfWeek(refDate, { weekStartsOn: 1 })
      : range === "month"
        ? endOfMonth(refDate)
        : range === "custom"
          ? customEnd
          : parseDate(todayStr);
  const rangeStartStr = format(rangeStart, "yyyy-MM-dd");
  const rangeEndStr = format(rangeEnd, "yyyy-MM-dd");

  // eachDayOfInterval works in CALENDAR days — immune to the
  // "endOfWeek returns Sunday 23:59:59.999" off-by-one bug that the
  // previous millisecond-diff + Math.round was producing (Week was
  // rendering 8 days; Month silently rendered N+1).
  const dateCols: GridDateCol[] = eachDayOfInterval({
    start: rangeStart,
    end: rangeEnd,
  }).map((d) => ({ date: d, dateStr: format(d, "yyyy-MM-dd") }));

  // ---- 3. Split rhythmic vs single, then hide always-inactive ------------
  // An activity is "always inactive" inside the viewed range when its
  // lifetime doesn't overlap with [rangeStart, rangeEnd] at all — i.e.
  // it ended before the range began, or its start_date is after the
  // range ends. We hide those rows so a grid of "your real options
  // right now" stays focused.
  const rhythmicActivities = activities.filter(
    (a) =>
      a.rhythm.type !== "single" &&
      !alwaysInactive(a.start_date, a.end_date, rangeStartStr, rangeEndStr)
  );
  const singleActivities = activities.filter(
    (a) => a.rhythm.type === "single"
  );

  // ---- 4. Fetch instances ------------------------------------------------
  const rhythmicIds = rhythmicActivities.map((a) => a.id);
  const singleIds = singleActivities.map((a) => a.id);

  type InstanceRow = {
    id: string;
    activity_id: string;
    scheduled_for: string;
    status: string;
    tags: string[] | null;
    // Per-occurrence overrides — threaded through toDayInstance so the
    // ActivityModal opened from a grid cell shows/edits this
    // occurrence's own name/notes/priority.
    name: string | null;
    notes: string | null;
    priority: number | null;
    comment: string | null;
    completion_instances: Array<{ completion_id: string }> | null;
  };
  // For singles we need the full instance + completion-count payload
  // so the expandable banner can open each into the same ActivityModal
  // that pending rows open. The fields mirror what InstanceRow shape
  // expects (DayInstance).
  type SingleInstanceRow = {
    id: string;
    activity_id: string;
    scheduled_for: string;
    status: string;
    tags: string[] | null;
    name: string | null;
    notes: string | null;
    priority: number | null;
    comment: string | null;
    completion_instances: Array<{ completion_id: string }> | null;
  };
  // Streak data: ALL past-or-today instances per rhythmic activity. No
  // lookback cap — the streak walks back until it hits a missed/
  // unlabeled or runs out of history. Sorted DESC so the walker stops
  // at the first non-completed past period. (If this ever gets heavy
  // for multi-year users, move to a per-activity `last_break_at`
  // aggregate column updated on completion — noted in BACKLOG.)
  type StreakInst = {
    activity_id: string;
    scheduled_for: string;
    status: string;
  };

  // ---- PERF: all three instance fetches in ONE parallel batch -----------
  // rhythmicInstances (the visible cells), singlesInstances (the
  // one-time-events banner), and streakInstances (per-row streak
  // counters) each depend ONLY on the activity-id lists computed above,
  // never on one another. Running them serially stacked three Supabase
  // round-trips on the heaviest view in the app; Promise.all collapses
  // them to the latency of the single slowest query.
  const [rhythmicInstances, singlesInstances, streakInstances] =
    await Promise.all([
      rhythmicIds.length === 0
        ? Promise.resolve([] as InstanceRow[])
        : supabase
            .from("activity_instances")
            .select(
              "id, activity_id, scheduled_for, status, tags, name, notes, priority, comment, completion_instances ( completion_id )"
            )
            .in("activity_id", rhythmicIds)
            .gte("scheduled_for", rangeStartStr)
            .lte("scheduled_for", rangeEndStr)
            .then((r) => (r.data ?? []) as unknown as InstanceRow[]),
      singleIds.length === 0
        ? Promise.resolve([] as SingleInstanceRow[])
        : supabase
            .from("activity_instances")
            .select(
              "id, activity_id, scheduled_for, status, tags, name, notes, priority, comment, completion_instances ( completion_id )"
            )
            .in("activity_id", singleIds)
            .gte("scheduled_for", rangeStartStr)
            .lte("scheduled_for", rangeEndStr)
            .order("scheduled_for", { ascending: true })
            .then((r) => (r.data ?? []) as unknown as SingleInstanceRow[]),
      rhythmicIds.length === 0
        ? Promise.resolve([] as StreakInst[])
        : supabase
            .from("activity_instances")
            .select("activity_id, scheduled_for, status")
            .in("activity_id", rhythmicIds)
            .lte("scheduled_for", todayStr)
            .order("scheduled_for", { ascending: false })
            .then((r) => (r.data ?? []) as StreakInst[]),
    ]);

  let singlesDone = 0;
  const singlesTotal = singlesInstances.length;
  for (const s of singlesInstances) {
    if (s.status === "completed") singlesDone++;
  }

  // Build the DayInstance list the GridTable's expandable banner will
  // render. Join each instance back to its parent single-activity (so
  // the modal opens with the right name / notes / etc.).
  const singleActivitiesById = new Map(
    singleActivities.map((a) => [a.id, a])
  );
  const singlesForBanner: DayInstance[] = singlesInstances
    .map((s): DayInstance | null => {
      const act = singleActivitiesById.get(s.activity_id);
      if (!act) return null;
      return toDayInstance(s, act);
    })
    .filter((v): v is DayInstance => v !== null);

  // ---- 5. Index instances per (activity, date) for fast lookup ----------
  const instancesByActivityDate = new Map<string, Map<string, InstanceRow>>();
  for (const i of rhythmicInstances) {
    let inner = instancesByActivityDate.get(i.activity_id);
    if (!inner) {
      inner = new Map();
      instancesByActivityDate.set(i.activity_id, inner);
    }
    inner.set(i.scheduled_for, i);
  }

  // ---- 5b. Streak index (data fetched in the parallel batch above) ------
  const streakByActivity = new Map<string, StreakInst[]>();
  for (const inst of streakInstances) {
    const arr = streakByActivity.get(inst.activity_id) ?? [];
    arr.push(inst); // already DESC from query, so order preserved
    streakByActivity.set(inst.activity_id, arr);
  }

  // ---- 6. Build row data -------------------------------------------------
  const rows: GridTableRow[] = rhythmicActivities.map((act) => {
    const byDate = instancesByActivityDate.get(act.id);

    let done = 0;
    let missed = 0;
    let unlabeled = 0;
    // `totalInPeriod` counts every cell where the activity was actually
    // scheduled for this row — done + missed + unlabeled + still-future-
    // scheduled. It deliberately excludes "outside" (before start /
    // after end) and "not-scheduled" (rhythm doesn't apply that day).
    // Drives the days-column "Most scheduled in period" sort, which the
    // user wants to be a pure "demand of this activity in this period"
    // metric regardless of completion state.
    let totalInPeriod = 0;

    const cells: GridTableCell[] = dateCols.map(({ dateStr }) => {
      // "Outside" if the day predates the activity or lies past its end.
      if (dateStr < act.start_date) {
        return makeNonInstanceCell("outside", dateStr);
      }
      if (act.end_date && dateStr > act.end_date) {
        return makeNonInstanceCell("outside", dateStr);
      }
      const inst = byDate?.get(dateStr);
      if (!inst) {
        return makeNonInstanceCell("not-scheduled", dateStr);
      }
      let state: GridCellStateLocal;
      if (inst.status === "completed") {
        state = "completed";
        done++;
      } else if (inst.status === "missed") {
        state = "missed";
        missed++;
      } else if (dateStr < todayStr) {
        // pending + past — what we now show to the user as "Unlabeled".
        state = "overdue";
        unlabeled++;
      } else {
        state = "scheduled";
      }
      // Any of the four scheduled states counts toward total demand.
      totalInPeriod++;
      return {
        state,
        dateStr,
        instance: toDayInstance(inst, act),
      };
    });

    const onTheHook = done + missed + unlabeled;
    const pct = onTheHook === 0 ? null : Math.round((done / onTheHook) * 100);

    // Effective streak mode for this activity (Settings → Streaks), and the
    // value to display for it.
    const effectiveMode: StreakMode =
      streakScope === "independent"
        ? isStreakMode(act.streak_mode)
          ? act.streak_mode
          : globalStreakMode
        : globalStreakMode;
    const streakGoal =
      effectiveMode === "countdown"
        ? streakScope === "independent"
          ? act.streak_goal ?? globalStreakGoal
          : globalStreakGoal
        : null;
    const history = streakByActivity.get(act.id) ?? [];
    const streak = computeStreakValue(effectiveMode, history, todayStr);

    return {
      activity: {
        id: act.id,
        name: act.name,
        tags: act.default_skill_tags ?? [],
      },
      rhythmCategory: rhythmCategoryLabel(
        act.rhythm,
        act.scheduled_times ?? []
      ),
      cells,
      pct,
      done,
      missed,
      unlabeled,
      onTheHook,
      totalInPeriod,
      streak,
      streakMode: effectiveMode,
      streakGoal,
    };
  });

  // ---- 7. Navigator metadata --------------------------------------------
  const prevDate =
    range === "week"
      ? format(addDays(rangeStart, -7), "yyyy-MM-dd")
      : range === "month"
        ? format(addMonths(rangeStart, -1), "yyyy-MM-dd")
        : gridDate;
  const nextDate =
    range === "week"
      ? format(addDays(rangeStart, 7), "yyyy-MM-dd")
      : range === "month"
        ? format(addMonths(rangeStart, 1), "yyyy-MM-dd")
        : gridDate;

  // For custom range, prev/next shift the window by its current
  // width. e.g. a 30-day window pressed "next" becomes the next 30
  // days, with the days touching the previous window's last day.
  const customWidthDays =
    range === "custom"
      ? Math.max(
          0,
          Math.round(
            (rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000
          )
        )
      : 0;
  const customPrevFrom =
    range === "custom"
      ? format(addDays(rangeStart, -(customWidthDays + 1)), "yyyy-MM-dd")
      : null;
  const customPrevTo =
    range === "custom"
      ? format(addDays(rangeStart, -1), "yyyy-MM-dd")
      : null;
  const customNextFrom =
    range === "custom"
      ? format(addDays(rangeEnd, 1), "yyyy-MM-dd")
      : null;
  const customNextTo =
    range === "custom"
      ? format(addDays(rangeEnd, customWidthDays + 1), "yyyy-MM-dd")
      : null;

  const label =
    range === "week"
      ? `${format(rangeStart, "MMM d")} – ${format(rangeEnd, "MMM d, yyyy")}`
      : range === "month"
        ? format(refDate, "MMMM yyyy")
        : range === "custom"
          ? `${format(rangeStart, "MMM d")} – ${format(rangeEnd, "MMM d, yyyy")} (${customWidthDays + 1} days)`
          : rhythmicForRange.length === 0
            ? "All time (no activities yet)"
            : `Since ${format(rangeStart, "MMM d, yyyy")}`;

  const bannerRangeLabel =
    range === "week"
      ? "this week"
      : range === "month"
        ? "this month"
        : range === "custom"
          ? "in this range"
          : "in the visible range";

  return (
    // GridSection owns the sticky navigator + tag-filter popover and
    // the table itself, so the filter button can live INSIDE the
    // navigator row (sharing its sticky offset) without ballooning the
    // vertical footprint of the page header.
    <div className="flex flex-col gap-4">
      <GridSection
        range={range}
        currentDate={gridDate}
        prevDate={prevDate}
        nextDate={nextDate}
        // Custom-specific nav: the four window-shift dates are null for
        // every other range so the navigator can ignore them.
        customFrom={range === "custom" ? format(rangeStart, "yyyy-MM-dd") : null}
        customTo={range === "custom" ? format(rangeEnd, "yyyy-MM-dd") : null}
        customPrevFrom={customPrevFrom}
        customPrevTo={customPrevTo}
        customNextFrom={customNextFrom}
        customNextTo={customNextTo}
        label={label}
        incompleteInfo={incompleteInfo}
        // Custom range reuses Total's heatmap layout because it scales
        // gracefully from a single week (a few columns) up to many
        // months (the column-major-week heatmap caps cell size). The
        // navigator UI handles all the custom-ness; the table doesn't
        // need to know.
        mode={range === "custom" ? "total" : range}
        rows={rows}
        dateCols={dateCols}
        todayStr={todayStr}
        rangeLabel={bannerRangeLabel}
        singlesDone={singlesDone}
        singlesTotal={singlesTotal}
        singles={singlesForBanner}
        userId={userId}
        tagMap={tagMap}
        showStats={showStats}
        statsAccuracy={statsAccuracy}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers used by GridView only.
// ---------------------------------------------------------------------------

type GridCellStateLocal =
  | "completed"
  | "missed"
  | "overdue"
  | "scheduled"
  | "not-scheduled"
  | "outside";

type GridDateCol = { date: Date; dateStr: string };

type GridTableCell = {
  state: GridCellStateLocal;
  dateStr: string;
  instance: DayInstance | null;
};

type GridTableRow = {
  activity: { id: string; name: string; tags: string[] };
  rhythmCategory: string;
  cells: GridTableCell[];
  pct: number | null;
  done: number;
  missed: number;
  unlabeled: number;
  onTheHook: number;
  totalInPeriod: number;
  streak: number;
  streakMode: StreakMode;
  streakGoal: number | null;
};

function makeNonInstanceCell(
  state: "not-scheduled" | "outside",
  dateStr: string
): GridTableCell {
  return { state, dateStr, instance: null };
}

// True when the activity's lifetime doesn't intersect the visible range
// at all — so every cell on its row would be "outside" and the row
// would be visual noise.
function alwaysInactive(
  startDate: string,
  endDate: string | null,
  rangeStartStr: string,
  rangeEndStr: string
): boolean {
  if (startDate > rangeEndStr) return true;
  if (endDate && endDate < rangeStartStr) return true;
  return false;
}


// Assemble the full DayInstance the ActivityModal expects from an
// instance row + its parent activity row. Keeping this conversion in
// one place means cells, oldest-pending row clicks, and any future
// surface that wants to open the modal stay in sync.
function toDayInstance(
  inst: {
    id: string;
    scheduled_for: string;
    status?: string | null;
    tags?: string[] | null;
    // Per-occurrence overrides (instance columns). Optional so callers
    // that don't select them still type-check; absent → inherit.
    name?: string | null;
    notes?: string | null;
    priority?: number | null;
    comment?: string | null;
    completion_instances: Array<{ completion_id: string }> | null;
  },
  act: {
    id: string;
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    priority: number;
    scheduled_times: string[];
    scheduled_end_times?: string[] | null;
    default_skill_tags: string[];
    start_date: string;
    end_date: string | null;
    archived_at: string | null;
    reminders: Array<{ amount: number; unit: string }>;
    track_on_grid: boolean;
    rollover_missed_days?: boolean;
    rollover_change_rhythm?: boolean;
    auto_archive?: boolean;
  }
): DayInstance {
  return {
    id: inst.id,
    scheduled_for: inst.scheduled_for,
    // Snapshot per-instance tags. If the row didn't include this
    // column (legacy data, or query that didn't select it), fall back
    // to the activity's CURRENT tags — still reasonable since we
    // can't know what they were historically.
    status:
      inst.status === "completed" || inst.status === "missed"
        ? inst.status
        : "pending",
    tags: inst.tags ?? act.default_skill_tags ?? [],
    overrideName: inst.name ?? null,
    overrideNotes: inst.notes ?? null,
    overridePriority: inst.priority ?? null,
    comment: inst.comment ?? null,
    completionCount: inst.completion_instances?.length ?? 0,
    activity: {
      id: act.id,
      name: act.name,
      notes: act.notes,
      rhythm: act.rhythm,
      priority: act.priority,
      scheduled_times: act.scheduled_times ?? [],
      scheduled_end_times: act.scheduled_end_times ?? [],
      default_skill_tags: act.default_skill_tags ?? [],
      start_date: act.start_date,
      end_date: act.end_date,
      archived_at: act.archived_at,
      reminders: act.reminders ?? [],
      track_on_grid: act.track_on_grid,
      // Toggles default to false when the query didn't select them —
      // the Edit Rhythm form just reflects the last-saved state.
      rollover_missed_days: act.rollover_missed_days ?? false,
      rollover_change_rhythm: act.rollover_change_rhythm ?? false,
      auto_archive: act.auto_archive ?? false,
    },
  };
}

// ---------------------------------------------------------------------------

/* MonthBanner / MonthCell / MonthBannerPill / summarizeOverflow now
   live in ./_components/month-cell.tsx (imported above) so the
   client-side MonthList can reuse them. */

// ---------------------------------------------------------------------------

