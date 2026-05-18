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
import Link from "next/link";

import { signOut } from "@/app/actions/auth";
import { ensureInstancesBackfilled } from "@/lib/domain/backfill";
import { rhythmCategoryLabel } from "@/lib/domain/rhythm-summary";
import { computeStreak } from "@/lib/domain/streak";
import { createClient } from "@/lib/supabase/server";
import type { Rhythm } from "@/lib/validators/rhythm";

import { DateNavigator } from "./_components/date-navigator";
import {
  DayList,
  type DayInstance,
  type DayMarkedItem,
} from "./_components/day-list";
import { GridNavigator } from "./_components/grid-navigator";
import { GridTable } from "./_components/grid-table";
import { type IncompleteInfo } from "./_components/incomplete-button";
import { MonthInstanceBox } from "./_components/month-instance-box";

type ViewKind = "day" | "week" | "month" | "year" | "grid";
type GridRange = "week" | "month" | "total";

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
];

// DayInstance (the shape passed to DayList) is imported from
// _components/day-list. WeekView still uses its own internal type below.

const WEEK_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TODAY_STR = new Date().toISOString().slice(0, 10);
// Day view window: how many days back / forward from the selected date.
// Matches DayList's constants; controls how wide a slice we fetch.
const DAY_VIEW_BACK = 90;
const DAY_VIEW_AHEAD = 180;

// ---------------------------------------------------------------------------

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string; range?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <SignedOutLanding />;

  const params = await searchParams;
  const view = parseView(params.view);
  const date = parseDateParam(params.date);
  const range = parseGridRange(params.range);

  // Top up the user's activity_instances out to ~1 year ahead of whatever
  // they're looking at. Indefinite rhythms (no end_date) only get N days
  // of instances generated up front; without this, the calendar "runs
  // out" of future days after that window.
  //
  // Why 1 year and not "truly infinite": we materialize one row per
  // occurrence (so each instance can carry its own completed/missed/X-of-Y
  // state). Generating to truly-infinite would mean rows we'll never
  // look at. 1 year is "feels indefinite to a human navigating forward"
  // while keeping a sane upper bound on row count. The real
  // architectural fix — store the rhythm rule only and project at view
  // time, materialize on interaction — is in BACKLOG.md.
  //
  // Idempotent: already-present instances get skipped via the unique
  // index + ignoreDuplicates on upsert inside backfill.
  const backfillThrough = (() => {
    const [y, m, d] = date.split("-").map(Number);
    const ref = new Date(y, m - 1, d);
    ref.setFullYear(ref.getFullYear() + 1);
    return format(ref, "yyyy-MM-dd");
  })();
  await ensureInstancesBackfilled(supabase, user.id, backfillThrough);

  // ---- "Incomplete" surfacing -------------------------------------------
  // Past-dated instances still in `pending` status (the user neither
  // completed them nor marked them missed) feed the per-view "Incomplete"
  // chip. We grab the OLDEST such date plus the total count in one round
  // trip via an HEAD + ORDER ASC + LIMIT 1, since the same numbers feed
  // every view.
  //
  // We exclude archived activities — they shouldn't keep nagging from a
  // past life. RLS already scopes to the current user; the inner-join on
  // `activities` filters by archived_at.
  const incompleteInfo = await fetchIncompleteInfo(supabase);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-8 p-6">
      <header className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Mission</h1>
            <p className="text-xs text-zinc-500">{user.email}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/activities/new"
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              + Add Activity
            </Link>
            <Link
              href="/activities"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Archive
            </Link>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

      </header>

      {/* ViewSwitcher and each view's date navigator stay pinned at the
          top while the user scrolls through the grid (or any long
          view). The two stack via a fixed offset: ViewSwitcher at
          top-0, navigator at top-[6.5rem] below it. The -mx-6 + px-6
          lets the background extend across the page padding so
          scrolled content doesn't show through their edges.
          Per user spec: "make the grid view like the calendar view
          where the date and view selections do not move/go out of
          view as you scroll." */}
      <div className="sticky top-0 z-30 -mx-6 bg-white px-6 py-2 dark:bg-zinc-950">
        <ViewSwitcher
          section={view === "grid" ? "grid" : "calendar"}
          currentView={view}
          range={range}
          date={date}
        />
      </div>

      {view === "day" && (
        <DayView startDate={date} incompleteInfo={incompleteInfo} />
      )}
      {view === "week" && (
        <WeekView weekDate={date} incompleteInfo={incompleteInfo} />
      )}
      {view === "month" && (
        <MonthView monthDate={date} incompleteInfo={incompleteInfo} />
      )}
      {view === "year" && (
        <YearView yearDate={date} incompleteInfo={incompleteInfo} />
      )}
      {view === "grid" && (
        <GridView
          gridDate={date}
          range={range}
          userId={user.id}
          incompleteInfo={incompleteInfo}
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// fetchIncompleteInfo — used by every view's navigator to power the
// "Incomplete (N)" chip + jump-to-oldest behavior.
// ---------------------------------------------------------------------------

async function fetchIncompleteInfo(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<IncompleteInfo> {
  // Strictly-past pending instances on still-active activities. "Strictly
  // less than today" so the chip doesn't pester the user about things
  // they still have today to finish.
  //
  // Two-step pattern (rather than a single nested-FK query):
  //   1. Fetch active activity IDs.
  //   2. Count & find oldest pending instance by `activity_id in (...)`.
  //
  // Why not a one-trip `activities!inner` + `head: true` + count: "exact"?
  // PostgREST's count semantics when an inner-join filter is layered on
  // a head-only query were undercounting in practice (the per-activity
  // "Unlabeled N" badges in the grid would show a number while the
  // page-level chip stayed at 0 — visible mismatch the user reported).
  // Two simple queries cost a tiny extra round-trip but are reliable.
  const { data: activeIds } = await supabase
    .from("activities")
    .select("id")
    .is("archived_at", null);

  const ids = ((activeIds ?? []) as Array<{ id: string }>).map((a) => a.id);

  if (ids.length === 0) {
    return { count: 0, oldestDate: null };
  }

  const [countResult, oldestResult] = await Promise.all([
    supabase
      .from("activity_instances")
      .select("id", { count: "exact", head: true })
      .in("activity_id", ids)
      .eq("status", "pending")
      .lt("scheduled_for", TODAY_STR),
    supabase
      .from("activity_instances")
      .select("scheduled_for")
      .in("activity_id", ids)
      .eq("status", "pending")
      .lt("scheduled_for", TODAY_STR)
      .order("scheduled_for", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    count: countResult.count ?? 0,
    oldestDate:
      (oldestResult.data as { scheduled_for?: string } | null)?.scheduled_for ??
      null,
  };
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
  return "day";
}

function parseGridRange(raw: string | undefined): GridRange {
  if (raw === "month") return "month";
  if (raw === "total") return "total";
  return "week";
}

function parseDateParam(raw: string | undefined): string {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return TODAY_STR;
  const d = parseISO(raw);
  if (Number.isNaN(d.getTime())) return TODAY_STR;
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
          Track what you actually do — planned or not.
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
}: {
  section: Section;
  currentView: ViewKind;
  range: GridRange;
  date: string;
}) {
  // Clicking the "Calendar" / "Grid" top tabs jumps to a sensible
  // default sub-tab (Day for Calendar, Week for Grid) when crossing
  // sections. Within a section the user can hop sub-tabs freely.
  const calendarHref = `/?view=day&date=${date}`;
  const gridHref = `/?view=grid&range=week&date=${date}`;

  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: section tabs */}
      <nav
        className="flex gap-1 rounded-md border border-zinc-200 p-1 dark:border-zinc-800"
        aria-label="Section"
      >
        <SectionTab
          label="Calendar"
          href={calendarHref}
          active={section === "calendar"}
        />
        <SectionTab
          label="Grid"
          href={gridHref}
          active={section === "grid"}
        />
      </nav>

      {/* Row 2: sub-tabs (Calendar's day/week/month/year, or Grid's
          week/month/total ranges). */}
      {section === "calendar" ? (
        <nav
          className="flex gap-1 rounded-md border border-zinc-200 p-1 dark:border-zinc-800"
          aria-label="Calendar view"
        >
          {CALENDAR_SUB_OPTIONS.map((opt) => (
            <SubTab
              key={opt.value}
              label={opt.label}
              href={`/?view=${opt.value}&date=${date}`}
              active={opt.value === currentView}
            />
          ))}
        </nav>
      ) : (
        <nav
          className="flex gap-1 rounded-md border border-zinc-200 p-1 dark:border-zinc-800"
          aria-label="Grid range"
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
// the page-level ViewSwitcher (which sticks at top-0). The fixed
// `top-[6.5rem]` offset assumes ViewSwitcher's rendered height of
// ~88px plus the wrapping py-2; tweak both together if either changes.
// The negative margin + matching horizontal padding lets the
// background color extend across the page's p-6 so scrolled content
// doesn't leak through behind the navigator.
function StickyNav({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-[6.5rem] z-20 -mx-6 bg-white px-6 py-2 dark:bg-zinc-950">
      {children}
    </div>
  );
}

function SectionTab({
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
      className={`flex-1 rounded px-3 py-1.5 text-center text-sm font-semibold transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
      }`}
    >
      {label}
    </Link>
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
      className={`flex-1 rounded px-3 py-1 text-center text-xs font-medium transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
      }`}
    >
      {label}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Day view — target date + the next 6 days stacked. Scroll for more.
// ---------------------------------------------------------------------------

async function DayView({
  startDate,
  incompleteInfo,
}: {
  startDate: string;
  incompleteInfo: IncompleteInfo;
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
  // Why bucketing by scheduled_for (not completion.occurred_at): a user
  // who completes Tuesday's gym on Saturday wants Tuesday's row to STAY
  // on Tuesday's banner — they're documenting what they did for that
  // scheduled day. Using occurred_at made it leap to Saturday, which
  // looked like the past had silently changed.
  const { data } = await supabase
    .from("activity_instances")
    .select(
      `
      id,
      scheduled_for,
      status,
      activities (
        id,
        name,
        notes,
        rhythm,
        priority,
        scheduled_times,
        default_skill_tags,
        start_date,
        end_date,
        archived_at,
        reminders
      ),
      completion_instances (
        completion_id
      )
    `
    )
    .gte("scheduled_for", windowStartStr)
    .lte("scheduled_for", windowEndStr)
    .order("scheduled_for");

  type RawInstance = {
    id: string;
    scheduled_for: string;
    status: string;
    activities: DayInstance["activity"] | null;
    completion_instances: Array<{ completion_id: string }> | null;
  };
  const raw = (data ?? []) as unknown as RawInstance[];
  const live = raw.filter(
    (r): r is RawInstance & { activities: DayInstance["activity"] } => {
      if (!r.activities) return false;
      if (r.activities.archived_at) return false;
      return true;
    }
  );

  const toInstance = (r: RawInstance & { activities: DayInstance["activity"] }): DayInstance => ({
    id: r.id,
    scheduled_for: r.scheduled_for,
    activity: r.activities,
    completionCount: r.completion_instances?.length ?? 0,
  });

  // Pending instances → the active list. Completed/missed → the dropdown.
  const instances: DayInstance[] = live
    .filter((r) => r.status === "pending")
    .map(toInstance);

  const completedByDate: Record<string, DayMarkedItem[]> = {};
  const missedByDate: Record<string, DayMarkedItem[]> = {};
  for (const r of live) {
    if (r.status === "completed") {
      (completedByDate[r.scheduled_for] ??= []).push({
        id: r.id,
        instance: toInstance(r),
      });
    } else if (r.status === "missed") {
      (missedByDate[r.scheduled_for] ??= []).push({
        id: r.id,
        instance: toInstance(r),
      });
    }
  }

  return (
    <DayList
      initialDate={startDate}
      instances={instances}
      completedByDate={completedByDate}
      missedByDate={missedByDate}
      todayStr={TODAY_STR}
      incompleteInfo={incompleteInfo}
    />
  );
}

// ---------------------------------------------------------------------------
// Week view — 7 columns. Each column = a Link to that day's Day view.
// Banners inside each column show that day's activities.
// ---------------------------------------------------------------------------

async function WeekView({
  weekDate,
  incompleteInfo,
}: {
  weekDate: string;
  incompleteInfo: IncompleteInfo;
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
      activities (
        id, name, rhythm, priority, scheduled_times, archived_at
      )
    `
    )
    .gte("scheduled_for", weekStartStr)
    .lte("scheduled_for", weekEndStr);

  type WeekInstance = {
    id: string;
    scheduled_for: string;
    status: string;
    activities: {
      id: string;
      name: string;
      rhythm: Rhythm;
      priority: number;
      scheduled_times: string[];
      archived_at: string | null;
    } | null;
  };

  const all = (data ?? []) as unknown as WeekInstance[];
  const byDate: Record<string, WeekInstance[]> = {};
  for (const i of all) {
    if (!i.activities || i.activities.archived_at) continue;
    (byDate[i.scheduled_for] ??= []).push(i);
  }
  for (const list of Object.values(byDate)) {
    list.sort((a, b) => {
      if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
      const pa = a.activities?.priority ?? 2;
      const pb = b.activities?.priority ?? 2;
      if (pa !== pb) return pa - pb;
      const ta = a.activities?.scheduled_times?.[0] ?? "99:99";
      const tb = b.activities?.scheduled_times?.[0] ?? "99:99";
      if (ta !== tb) return ta.localeCompare(tb);
      return (a.activities?.name ?? "").localeCompare(b.activities?.name ?? "");
    });
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const dateStr = format(date, "yyyy-MM-dd");
    return {
      date,
      dateStr,
      isToday: dateStr === TODAY_STR,
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
                  <WeekBanner key={i.id} item={i} />
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
}: {
  item: {
    status: string;
    activities: {
      name: string;
      priority: number;
      scheduled_times: string[];
    } | null;
  };
}) {
  if (!item.activities) return null;
  const isCompleted = item.status === "completed";
  const dotColor =
    item.activities.priority === 1
      ? "bg-red-500"
      : item.activities.priority === 2
        ? "bg-amber-500"
        : "bg-zinc-400";
  const firstTime = item.activities.scheduled_times?.[0];

  return (
    <li
      className={`flex min-w-0 items-start gap-0.5 overflow-hidden rounded px-1 py-0.5 text-[9px] leading-tight ${
        isCompleted
          ? "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-900 dark:text-zinc-600"
          : "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
      }`}
      title={`${item.activities.name}${firstTime ? ` @ ${firstTime}` : ""}`}
    >
      <span
        aria-hidden
        className={`mt-1 inline-block h-1 w-1 shrink-0 rounded-full ${dotColor}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block line-clamp-2 break-words font-medium">
          {item.activities.name}
        </span>
        {firstTime && <span className="block opacity-75">{firstTime}</span>}
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
  incompleteInfo,
}: {
  monthDate: string;
  incompleteInfo: IncompleteInfo;
}) {
  const supabase = await createClient();

  const refDate = parseDate(monthDate);
  const monthStart = startOfMonth(refDate);
  const monthEnd = endOfMonth(refDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });

  // Fetch over the visible grid (might include neighbor-month days)
  const gridEnd = addDays(gridStart, 41);
  const { data } = await supabase
    .from("activity_instances")
    .select(
      "id, scheduled_for, status, activities!inner(archived_at)"
    )
    .gte("scheduled_for", format(gridStart, "yyyy-MM-dd"))
    .lte("scheduled_for", format(gridEnd, "yyyy-MM-dd"))
    .is("activities.archived_at", null);

  type CellInstance = { id: string; status: string };
  const byDate: Record<string, CellInstance[]> = {};
  for (const i of (data ?? []) as Array<{
    id: string;
    scheduled_for: string;
    status: string;
  }>) {
    (byDate[i.scheduled_for] ??= []).push({ id: i.id, status: i.status });
  }

  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    const dateStr = format(date, "yyyy-MM-dd");
    return {
      date,
      dateStr,
      inMonth: date >= monthStart && date <= monthEnd,
      isToday: dateStr === TODAY_STR,
      instances: byDate[dateStr] ?? [],
    };
  });

  const prevDate = format(addMonths(monthStart, -1), "yyyy-MM-dd");
  const nextDate = format(addMonths(monthStart, 1), "yyyy-MM-dd");

  return (
    <div className="flex flex-col gap-3">
      <StickyNav>
        <DateNavigator
          view="month"
          currentDate={monthDate}
          prevDate={prevDate}
          nextDate={nextDate}
          label={format(refDate, "MMMM yyyy")}
          incompleteInfo={incompleteInfo}
        />
      </StickyNav>

      <div className="grid grid-cols-7 gap-1">
        {WEEK_HEADERS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-medium uppercase tracking-wide text-zinc-500"
          >
            {d}
          </div>
        ))}
        {cells.map((c) => (
          <MonthCell key={c.dateStr} {...c} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year view — 12 mini-month calendars in a 3-column grid, iPhone-Calendar
// style. Each month is clickable → jumps to Month view for that month.
// Days with activity are filled; today is ringed.
// ---------------------------------------------------------------------------

async function YearView({
  yearDate,
  incompleteInfo,
}: {
  yearDate: string;
  incompleteInfo: IncompleteInfo;
}) {
  const supabase = await createClient();
  const refDate = parseDate(yearDate);
  const year = refDate.getFullYear();

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const { data } = await supabase
    .from("activity_instances")
    .select(
      "scheduled_for, status, activities!inner(archived_at)"
    )
    .gte("scheduled_for", yearStart)
    .lte("scheduled_for", yearEnd)
    .is("activities.archived_at", null);

  const byDate: Record<string, { pending: number; completed: number }> = {};
  for (const i of (data ?? []) as Array<{
    scheduled_for: string;
    status: string;
  }>) {
    const d = (byDate[i.scheduled_for] ??= { pending: 0, completed: 0 });
    if (i.status === "pending") d.pending++;
    else if (i.status === "completed") d.completed++;
  }

  const months = Array.from({ length: 12 }, (_, m) => ({
    monthIndex: m,
    monthStart: new Date(year, m, 1),
  }));

  const dayOfYear = yearDate.slice(5); // "MM-DD"
  const prevDate = `${year - 1}-${dayOfYear}`;
  const nextDate = `${year + 1}-${dayOfYear}`;

  return (
    <div className="flex flex-col gap-3">
      <StickyNav>
        <DateNavigator
          view="year"
          currentDate={yearDate}
          prevDate={prevDate}
          nextDate={nextDate}
          label={String(year)}
          incompleteInfo={incompleteInfo}
        />
      </StickyNav>
      <div className="grid grid-cols-3 gap-4">
        {months.map((m) => (
          <MiniMonth
            key={m.monthIndex}
            monthStart={m.monthStart}
            byDate={byDate}
          />
        ))}
      </div>
    </div>
  );
}

function MiniMonth({
  monthStart,
  byDate,
}: {
  monthStart: Date;
  byDate: Record<string, { pending: number; completed: number }>;
}) {
  const monthEnd = endOfMonth(monthStart);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const monthDateStr = format(monthStart, "yyyy-MM-dd");
  const monthLabel = monthStart.toLocaleString(undefined, { month: "long" });

  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    const dateStr = format(date, "yyyy-MM-dd");
    const inMonth = date >= monthStart && date <= monthEnd;
    const counts = byDate[dateStr] ?? { pending: 0, completed: 0 };
    return {
      date,
      dateStr,
      inMonth,
      isToday: dateStr === TODAY_STR,
      hasActivity: inMonth && (counts.pending > 0 || counts.completed > 0),
    };
  });

  return (
    <Link
      href={`/?view=month&date=${monthDateStr}`}
      className="flex flex-col gap-1.5 rounded-md border border-zinc-200 p-2 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
    >
      <h3 className="text-center text-xs font-medium">{monthLabel}</h3>
      <div className="grid grid-cols-7 gap-px">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div
            key={i}
            className="text-center text-[8px] font-medium text-zinc-400"
          >
            {d}
          </div>
        ))}
        {cells.map((c) => (
          <div
            key={c.dateStr}
            className={`flex aspect-square items-center justify-center rounded text-[8px] ${
              !c.inMonth
                ? "text-zinc-200 dark:text-zinc-800"
                : c.hasActivity
                  ? "bg-zinc-900 font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "text-zinc-600 dark:text-zinc-400"
            } ${c.isToday ? "ring-1 ring-zinc-900 dark:ring-zinc-50" : ""}`}
          >
            {c.inMonth ? c.date.getDate() : ""}
          </div>
        ))}
      </div>
    </Link>
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
  range,
  userId,
  incompleteInfo,
}: {
  gridDate: string;
  range: GridRange;
  userId: string;
  incompleteInfo: IncompleteInfo;
}) {
  const supabase = await createClient();
  const refDate = parseDate(gridDate);

  // ---- 1. Fetch ALL non-archived activities (need start_date BEFORE we
  // compute Total's range, since Total spans from the earliest activity
  // start to today) -------------------------------------------------------
  const { data: activitiesRaw } = await supabase
    .from("activities")
    .select(
      "id, name, notes, rhythm, priority, scheduled_times, default_skill_tags, start_date, end_date, archived_at, reminders"
    )
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("name");

  type ActivityRow = {
    id: string;
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    priority: number;
    scheduled_times: string[];
    default_skill_tags: string[];
    start_date: string;
    end_date: string | null;
    archived_at: string | null;
    reminders: Array<{ amount: number; unit: string }>;
  };
  const activities = (activitiesRaw ?? []) as ActivityRow[];

  // ---- 2. Range bounds ---------------------------------------------------
  // Total = first rhythmic activity's start_date → today. NOT a fixed
  // 365-day window — if the user has only been at this for two weeks,
  // Total shows two weeks. If they've been at it for years, Total
  // shows years. The heatmap layout (7-row, week-aligned, column-
  // major flow) keeps the rendered width bounded regardless.
  const rhythmicForRange = activities.filter((a) => a.rhythm.type !== "single");
  const earliestStartStr =
    rhythmicForRange.length === 0
      ? TODAY_STR
      : rhythmicForRange.reduce(
          (min, a) => (a.start_date < min ? a.start_date : min),
          "9999-12-31"
        );

  const rangeStart: Date =
    range === "week"
      ? startOfWeek(refDate, { weekStartsOn: 1 })
      : range === "month"
        ? startOfMonth(refDate)
        : parseDate(earliestStartStr);
  const rangeEnd: Date =
    range === "week"
      ? endOfWeek(refDate, { weekStartsOn: 1 })
      : range === "month"
        ? endOfMonth(refDate)
        : parseDate(TODAY_STR);
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
    completion_instances: Array<{ completion_id: string }> | null;
  };

  const rhythmicInstances =
    rhythmicIds.length === 0
      ? []
      : (((
          await supabase
            .from("activity_instances")
            .select(
              "id, activity_id, scheduled_for, status, completion_instances ( completion_id )"
            )
            .in("activity_id", rhythmicIds)
            .gte("scheduled_for", rangeStartStr)
            .lte("scheduled_for", rangeEndStr)
        ).data ?? []) as unknown as InstanceRow[]);

  // For singles we need the full instance + completion-count payload
  // so the expandable banner can open each into the same ActivityModal
  // that pending rows open. The fields mirror what InstanceRow shape
  // expects (DayInstance).
  type SingleInstanceRow = {
    id: string;
    activity_id: string;
    scheduled_for: string;
    status: string;
    completion_instances: Array<{ completion_id: string }> | null;
  };
  const singlesInstances =
    singleIds.length === 0
      ? []
      : (((
          await supabase
            .from("activity_instances")
            .select(
              "id, activity_id, scheduled_for, status, completion_instances ( completion_id )"
            )
            .in("activity_id", singleIds)
            .gte("scheduled_for", rangeStartStr)
            .lte("scheduled_for", rangeEndStr)
            .order("scheduled_for", { ascending: true })
        ).data ?? []) as unknown as SingleInstanceRow[]);

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

  // ---- 5b. Streak data --------------------------------------------------
  // For the per-row streak counter we need ALL past-or-today instances
  // per activity, not just the in-range subset. We cap the lookback at
  // 365 days so the query stays bounded for power users; a streak longer
  // than one year is rare enough that the cap is acceptable for v1.
  //
  // Sorted DESC by scheduled_for so the streak walker can stop at the
  // first non-completed past period without scanning further history.
  const streakLookbackStr = format(
    addDays(parseDate(TODAY_STR), -365),
    "yyyy-MM-dd"
  );
  type StreakInst = { activity_id: string; scheduled_for: string; status: string };
  const streakInstances =
    rhythmicIds.length === 0
      ? []
      : (((
          await supabase
            .from("activity_instances")
            .select("activity_id, scheduled_for, status")
            .in("activity_id", rhythmicIds)
            .gte("scheduled_for", streakLookbackStr)
            .lte("scheduled_for", TODAY_STR)
            .order("scheduled_for", { ascending: false })
        ).data ?? []) as StreakInst[]);

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
      } else if (dateStr < TODAY_STR) {
        // pending + past — what we now show to the user as "Unlabeled".
        state = "overdue";
        unlabeled++;
      } else {
        state = "scheduled";
      }
      return {
        state,
        dateStr,
        instance: toDayInstance(inst, act),
      };
    });

    const onTheHook = done + missed + unlabeled;
    const pct = onTheHook === 0 ? null : Math.round((done / onTheHook) * 100);
    const streak = computeStreak(
      streakByActivity.get(act.id) ?? [],
      act.rhythm,
      TODAY_STR
    );

    return {
      activity: { id: act.id, name: act.name },
      rhythmCategory: rhythmCategoryLabel(act.rhythm),
      cells,
      pct,
      done,
      missed,
      unlabeled,
      onTheHook,
      streak,
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

  const label =
    range === "week"
      ? `${format(rangeStart, "MMM d")} – ${format(rangeEnd, "MMM d, yyyy")}`
      : range === "month"
        ? format(refDate, "MMMM yyyy")
        : rhythmicForRange.length === 0
          ? "All time (no activities yet)"
          : `Since ${format(rangeStart, "MMM d, yyyy")}`;

  const bannerRangeLabel =
    range === "week"
      ? "this week"
      : range === "month"
        ? "this month"
        : "in the visible range";

  return (
    <div className="flex flex-col gap-4">
      <StickyNav>
        <GridNavigator
          range={range}
          currentDate={gridDate}
          prevDate={prevDate}
          nextDate={nextDate}
          label={label}
          incompleteInfo={incompleteInfo}
        />
      </StickyNav>

      <GridTable
        mode={range}
        rows={rows}
        dateCols={dateCols}
        todayStr={TODAY_STR}
        rangeLabel={bannerRangeLabel}
        singlesDone={singlesDone}
        singlesTotal={singlesTotal}
        singles={singlesForBanner}
        userId={userId}
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
  activity: { id: string; name: string };
  rhythmCategory: string;
  cells: GridTableCell[];
  pct: number | null;
  done: number;
  missed: number;
  unlabeled: number;
  onTheHook: number;
  streak: number;
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
    completion_instances: Array<{ completion_id: string }> | null;
  },
  act: {
    id: string;
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    priority: number;
    scheduled_times: string[];
    default_skill_tags: string[];
    start_date: string;
    end_date: string | null;
    archived_at: string | null;
    reminders: Array<{ amount: number; unit: string }>;
  }
): DayInstance {
  return {
    id: inst.id,
    scheduled_for: inst.scheduled_for,
    completionCount: inst.completion_instances?.length ?? 0,
    activity: {
      id: act.id,
      name: act.name,
      notes: act.notes,
      rhythm: act.rhythm,
      priority: act.priority,
      scheduled_times: act.scheduled_times ?? [],
      default_skill_tags: act.default_skill_tags ?? [],
      start_date: act.start_date,
      end_date: act.end_date,
      archived_at: act.archived_at,
      reminders: act.reminders ?? [],
    },
  };
}

// ---------------------------------------------------------------------------

function MonthCell({
  date,
  dateStr,
  inMonth,
  isToday,
  instances,
}: {
  date: Date;
  dateStr: string;
  inMonth: boolean;
  isToday: boolean;
  instances: Array<{ id: string; status: string }>;
}) {
  const hasAny = instances.length > 0;
  const MAX_BOXES = 5;
  const shown = instances.slice(0, MAX_BOXES);
  const extra = Math.max(0, instances.length - MAX_BOXES);

  let cls =
    "relative flex aspect-square flex-col items-center gap-0.5 rounded p-1 text-xs transition-colors";
  if (!inMonth) cls += " text-zinc-400 dark:text-zinc-600";
  else cls += " text-zinc-700 dark:text-zinc-300";
  if (isToday) cls += " ring-1 ring-zinc-900 dark:ring-zinc-50";
  if (hasAny && inMonth) cls += " bg-zinc-50 dark:bg-zinc-950";

  return (
    <div className={cls}>
      {/* Whole-cell click target → day view. Boxes layered on top capture
          their own clicks. */}
      <Link
        href={`/?view=day&date=${dateStr}`}
        aria-label={`Open ${dateStr}`}
        className="absolute inset-0 z-0 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900"
      />
      <span className={`relative z-10 pointer-events-none ${isToday ? "font-semibold" : ""}`}>
        {date.getDate()}
      </span>
      {inMonth && hasAny && (
        <div className="relative z-10 mt-0.5 flex flex-wrap items-center justify-center gap-px">
          {shown.map((inst) => (
            <MonthInstanceBox
              key={inst.id}
              instanceId={inst.id}
              status={inst.status}
              scheduledFor={dateStr}
            />
          ))}
          {extra > 0 && (
            <span className="pointer-events-none text-[8px] font-medium text-zinc-500">
              +{extra}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

