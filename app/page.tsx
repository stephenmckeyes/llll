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
import { createClient } from "@/lib/supabase/server";

import { DateNavigator } from "./_components/date-navigator";
import {
  DayList,
  type CompletedItem,
  type DayInstance,
} from "./_components/day-list";
import { GridNavigator } from "./_components/grid-navigator";
import { MonthInstanceBox } from "./_components/month-instance-box";

type ViewKind = "day" | "week" | "month" | "year" | "grid";
type GridRange = "week" | "month";

type Rhythm =
  | { type: "single" }
  | { type: "daily" }
  | { type: "weekdays"; days: string[] }
  | { type: "interval"; days: number }
  | { type: "frequency"; count: number; period: "day" | "week" | "month" };

// DayInstance (the shape passed to DayList) is imported from
// _components/day-list. WeekView still uses its own internal type below.

const VIEW_OPTIONS: ReadonlyArray<{ value: ViewKind; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "grid", label: "Grid" },
];

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
              Manage
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

        <ViewSwitcher current={view} date={date} />
      </header>

      {view === "day" && <DayView startDate={date} userId={user.id} />}
      {view === "week" && <WeekView weekDate={date} />}
      {view === "month" && <MonthView monthDate={date} />}
      {view === "year" && <YearView yearDate={date} />}
      {view === "grid" && (
        <GridView gridDate={date} range={range} userId={user.id} />
      )}
    </main>
  );
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
  return raw === "month" ? "month" : "week";
}

function parseDateParam(raw: string | undefined): string {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return TODAY_STR;
  const d = parseISO(raw);
  if (Number.isNaN(d.getTime())) return TODAY_STR;
  return raw;
}

// Supabase JS sometimes types to-one relationships as arrays. This helper
// peels off the array so the call site doesn't need ternaries everywhere.
function firstOrSelf<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return (v[0] as T) ?? null;
  return v;
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

function ViewSwitcher({
  current,
  date,
}: {
  current: ViewKind;
  date: string;
}) {
  return (
    <nav
      className="flex gap-1 rounded-md border border-zinc-200 p-1 dark:border-zinc-800"
      aria-label="View"
    >
      {VIEW_OPTIONS.map((opt) => {
        const active = opt.value === current;
        const href = `/?view=${opt.value}&date=${date}`;
        return (
          <Link
            key={opt.value}
            href={href}
            className={`flex-1 rounded px-3 py-1 text-center text-sm font-medium transition-colors ${
              active
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            {opt.label}
          </Link>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Day view — target date + the next 6 days stacked. Scroll for more.
// ---------------------------------------------------------------------------

async function DayView({
  startDate,
  userId,
}: {
  startDate: string;
  userId: string;
}) {
  const supabase = await createClient();

  const startD = parseDate(startDate);
  const windowStartD = addDays(startD, -DAY_VIEW_BACK);
  const windowEndD = addDays(startD, DAY_VIEW_AHEAD);
  const windowStartStr = format(windowStartD, "yyyy-MM-dd");
  const windowEndStr = format(windowEndD, "yyyy-MM-dd");

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
    .eq("status", "pending")
    .gte("scheduled_for", windowStartStr)
    .lte("scheduled_for", windowEndStr)
    .order("scheduled_for");

  type RawInstance = {
    id: string;
    scheduled_for: string;
    activities: DayInstance["activity"] | null;
    completion_instances: Array<{ completion_id: string }> | null;
  };
  const raw = (data ?? []) as unknown as RawInstance[];

  const instances: DayInstance[] = raw
    .filter((r): r is RawInstance & { activities: DayInstance["activity"] } =>
      Boolean(r.activities)
    )
    .map((r) => ({
      id: r.id,
      scheduled_for: r.scheduled_for,
      activity: r.activities,
      completionCount: r.completion_instances?.length ?? 0,
    }));

  // ---- Completed items for the "Completed (N)" banner per day -----------
  // Fetch every completion whose occurred_at falls in the visible window,
  // joined back to its activity name through the M:N link table. Single
  // completions can technically be linked to multiple instances; we just
  // surface one row per link.
  const { data: completionsRaw } = await supabase
    .from("completions")
    .select(
      `
      id,
      occurred_at,
      user_id,
      completion_instances (
        instance_id,
        activity_instances (
          activity_id,
          activities ( id, name, rhythm )
        )
      )
    `
    )
    .eq("user_id", userId)
    .gte("occurred_at", windowStartStr + "T00:00:00")
    .lte("occurred_at", windowEndStr + "T23:59:59")
    .is("deleted_at", null)
    .order("occurred_at", { ascending: false });

  // Supabase JS returns nested to-one relationships as either an object OR
  // an array of one — depends on FK inference. Tolerate both by taking the
  // first element when it's an array.
  type CompletionRowLoose = {
    id: string;
    occurred_at: string;
    completion_instances?:
      | Array<{
          instance_id: string;
          activity_instances?: unknown;
        }>
      | null;
  };

  const completedByDate: Record<string, CompletedItem[]> = {};
  for (const c of (completionsRaw ?? []) as unknown as CompletionRowLoose[]) {
    const day = c.occurred_at.slice(0, 10);
    const links = c.completion_instances ?? [];
    if (links.length === 0) {
      // Ad-hoc completion not linked to any instance.
      (completedByDate[day] ??= []).push({
        id: c.id,
        occurredAt: c.occurred_at,
        activityName: "Ad-hoc log",
      });
      continue;
    }
    for (const link of links) {
      const ai = firstOrSelf(link.activity_instances);
      const activity = firstOrSelf(
        (ai as { activities?: unknown } | null)?.activities
      ) as { id: string; name: string; rhythm: Rhythm } | null;
      if (!activity) continue;
      (completedByDate[day] ??= []).push({
        id: `${c.id}:${link.instance_id}`,
        occurredAt: c.occurred_at,
        activityName: activity.name,
      });
    }
  }

  return (
    <DayList
      initialDate={startDate}
      instances={instances}
      completedByDate={completedByDate}
      todayStr={TODAY_STR}
    />
  );
}

// ---------------------------------------------------------------------------
// Week view — 7 columns. Each column = a Link to that day's Day view.
// Banners inside each column show that day's activities.
// ---------------------------------------------------------------------------

async function WeekView({ weekDate }: { weekDate: string }) {
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
      <DateNavigator
        view="week"
        currentDate={weekDate}
        prevDate={prevDate}
        nextDate={nextDate}
        label={`${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`}
      />

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

async function MonthView({ monthDate }: { monthDate: string }) {
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
      <DateNavigator
        view="month"
        currentDate={monthDate}
        prevDate={prevDate}
        nextDate={nextDate}
        label={format(refDate, "MMMM yyyy")}
      />

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

async function YearView({ yearDate }: { yearDate: string }) {
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
      <DateNavigator
        view="year"
        currentDate={yearDate}
        prevDate={prevDate}
        nextDate={nextDate}
        label={String(year)}
      />
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
// Grid view — habit-tracker matrix. Rows = activities, columns = days in
// the selected range, far-right column = success %.
//
// Cell coloring (per (activity, date) cell):
//   completed       — solid green, ✓
//   missed          — solid red, ✗
//   overdue         — amber (past pending; the user neither completed nor
//                     marked it missed yet)
//   scheduled       — light grey box (today or future, still on the
//                     menu)
//   not-scheduled   — blank (the rhythm didn't apply to this day)
//   outside-active  — diagonal-hatch (activity didn't exist yet, or was
//                     archived / its end_date passed)
//
// Success % counts completed / (completed + missed + overdue) — i.e.
// "of the days you were on the hook, what fraction did you do?"
// Future-scheduled days don't drag the score down because the user
// hasn't had a chance to do them yet.
// ---------------------------------------------------------------------------

type GridCellState =
  | "completed"
  | "missed"
  | "overdue"
  | "scheduled"
  | "not-scheduled"
  | "outside";

async function GridView({
  gridDate,
  range,
  userId,
}: {
  gridDate: string;
  range: GridRange;
  userId: string;
}) {
  const supabase = await createClient();
  const refDate = parseDate(gridDate);

  // Determine the visible range.
  const rangeStart =
    range === "week"
      ? startOfWeek(refDate, { weekStartsOn: 1 })
      : startOfMonth(refDate);
  const rangeEnd =
    range === "week"
      ? endOfWeek(refDate, { weekStartsOn: 1 })
      : endOfMonth(refDate);
  const rangeStartStr = format(rangeStart, "yyyy-MM-dd");
  const rangeEndStr = format(rangeEnd, "yyyy-MM-dd");

  // List of date strings inside the range, in order.
  const dayCount =
    Math.round(
      (rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000)
    ) + 1;
  const dateCols = Array.from({ length: dayCount }, (_, i) => {
    const d = addDays(rangeStart, i);
    return { date: d, dateStr: format(d, "yyyy-MM-dd") };
  });

  // 1) Every non-archived activity for the user. (Rows; we want activities
  //    that have NO instances in the range to still appear as a row — they
  //    were active but the rhythm just didn't hit any day in this window.
  //    A separate fetch is the cleanest way to get that.)
  const { data: activitiesRaw } = await supabase
    .from("activities")
    .select("id, name, start_date, end_date, priority, default_skill_tags")
    .eq("user_id", userId)
    .is("archived_at", null)
    .order("name");

  type ActivityRow = {
    id: string;
    name: string;
    start_date: string;
    end_date: string | null;
    priority: number;
    default_skill_tags: string[] | null;
  };
  const activities = (activitiesRaw ?? []) as ActivityRow[];

  // 2) Instances in [rangeStart, rangeEnd] for those activities. We need
  //    status + the instance's activity_id; everything else we already
  //    have from the activity row.
  const activityIds = activities.map((a) => a.id);
  const instances: Array<{
    activity_id: string;
    scheduled_for: string;
    status: string;
  }> =
    activityIds.length === 0
      ? []
      : (
          (
            await supabase
              .from("activity_instances")
              .select("activity_id, scheduled_for, status")
              .in("activity_id", activityIds)
              .gte("scheduled_for", rangeStartStr)
              .lte("scheduled_for", rangeEndStr)
          ).data ?? []
        );

  // Index instances by activity → date → status for O(1) cell lookup.
  const byActivity = new Map<string, Map<string, string>>();
  for (const i of instances) {
    let inner = byActivity.get(i.activity_id);
    if (!inner) {
      inner = new Map();
      byActivity.set(i.activity_id, inner);
    }
    inner.set(i.scheduled_for, i.status);
  }

  // Build row data.
  const rows = activities.map((act) => {
    const byDate = byActivity.get(act.id);
    const cells = dateCols.map(({ dateStr }) => {
      // "Outside" if the day predates the activity or lies past its end_date.
      if (dateStr < act.start_date) return "outside" as GridCellState;
      if (act.end_date && dateStr > act.end_date) {
        return "outside" as GridCellState;
      }
      const status = byDate?.get(dateStr);
      if (!status) return "not-scheduled" as GridCellState;
      if (status === "completed") return "completed" as GridCellState;
      if (status === "missed") return "missed" as GridCellState;
      // status === 'pending'
      return dateStr < TODAY_STR
        ? ("overdue" as GridCellState)
        : ("scheduled" as GridCellState);
    });

    // Success % = completed / (completed + missed + overdue).
    let onTheHook = 0;
    let done = 0;
    for (const c of cells) {
      if (c === "completed") {
        done++;
        onTheHook++;
      } else if (c === "missed" || c === "overdue") {
        onTheHook++;
      }
    }
    const pct = onTheHook === 0 ? null : Math.round((done / onTheHook) * 100);

    return { activity: act, cells, pct, onTheHook };
  });

  // Navigator prev/next dates: step by the range size.
  const prevDate =
    range === "week"
      ? format(addDays(rangeStart, -7), "yyyy-MM-dd")
      : format(addMonths(rangeStart, -1), "yyyy-MM-dd");
  const nextDate =
    range === "week"
      ? format(addDays(rangeStart, 7), "yyyy-MM-dd")
      : format(addMonths(rangeStart, 1), "yyyy-MM-dd");

  const label =
    range === "week"
      ? `${format(rangeStart, "MMM d")} – ${format(rangeEnd, "MMM d, yyyy")}`
      : format(refDate, "MMMM yyyy");

  return (
    <div className="flex flex-col gap-4">
      <GridNavigator
        range={range}
        currentDate={gridDate}
        prevDate={prevDate}
        nextDate={nextDate}
        label={label}
      />

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          No active activities yet. Add one to see it show up here.
        </p>
      ) : (
        // Horizontal scroll wrapper: on narrow viewports a month range can
        // easily run wider than the main column, so we let the table scroll
        // sideways while the activity-name column stays put via sticky-left.
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-20 border-b border-zinc-200 bg-white px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  Activity
                </th>
                {dateCols.map((c) => (
                  <th
                    key={c.dateStr}
                    scope="col"
                    className={`border-b border-zinc-200 px-1 py-2 text-center text-[10px] font-medium dark:border-zinc-800 ${
                      c.dateStr === TODAY_STR
                        ? "text-zinc-900 dark:text-zinc-50"
                        : "text-zinc-500"
                    }`}
                  >
                    <div className="uppercase tracking-wide">
                      {format(c.date, "EEE")}
                    </div>
                    <div
                      className={`text-sm ${
                        c.dateStr === TODAY_STR
                          ? "font-semibold"
                          : "font-normal"
                      }`}
                    >
                      {c.date.getDate()}
                    </div>
                  </th>
                ))}
                <th
                  scope="col"
                  className="sticky right-0 z-20 border-b border-l border-zinc-200 bg-white px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  Success
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.activity.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-zinc-100 bg-white px-2 py-1.5 text-left text-xs font-medium text-zinc-800 dark:border-zinc-900 dark:bg-zinc-950 dark:text-zinc-200"
                  >
                    <span
                      className="block max-w-[10rem] truncate"
                      title={row.activity.name}
                    >
                      {row.activity.name}
                    </span>
                  </th>
                  {row.cells.map((state, i) => (
                    <td
                      key={dateCols[i].dateStr}
                      className="border-b border-zinc-100 p-0.5 dark:border-zinc-900"
                    >
                      <GridCell
                        state={state}
                        dateStr={dateCols[i].dateStr}
                        activityName={row.activity.name}
                      />
                    </td>
                  ))}
                  <td
                    className={`sticky right-0 z-10 border-b border-l border-zinc-100 bg-white px-2 py-1.5 text-center text-xs dark:border-zinc-900 dark:bg-zinc-950 ${
                      row.pct === null
                        ? "text-zinc-400"
                        : row.pct >= 80
                          ? "font-semibold text-emerald-700 dark:text-emerald-300"
                          : row.pct >= 50
                            ? "text-amber-700 dark:text-amber-300"
                            : "text-red-700 dark:text-red-300"
                    }`}
                  >
                    {row.pct === null ? "—" : `${row.pct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <GridLegend />
    </div>
  );
}

function GridCell({
  state,
  dateStr,
  activityName,
}: {
  state: GridCellState;
  dateStr: string;
  activityName: string;
}) {
  // Each cell is a tiny clickable Link that jumps to the day view for that
  // date — clicking through to the day's instance is the natural "I want
  // to fix that" affordance once the user spots a missing day in the grid.
  const isToday = dateStr === TODAY_STR;
  const base =
    "flex aspect-square w-7 items-center justify-center rounded text-[10px] font-medium transition-colors";
  let cls = base;
  let label: string;
  let inner: React.ReactNode = "";

  switch (state) {
    case "completed":
      cls += " bg-emerald-500 text-white hover:bg-emerald-600";
      inner = "✓";
      label = `Completed — ${activityName} on ${dateStr}`;
      break;
    case "missed":
      cls += " bg-red-500 text-white hover:bg-red-600";
      inner = "✗";
      label = `Missed — ${activityName} on ${dateStr}`;
      break;
    case "overdue":
      cls += " bg-amber-300 text-amber-900 hover:bg-amber-400 dark:bg-amber-700 dark:text-amber-100";
      inner = "!";
      label = `Overdue — ${activityName} on ${dateStr}`;
      break;
    case "scheduled":
      cls += " border border-zinc-300 bg-zinc-50 text-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900";
      inner = "·";
      label = `Scheduled — ${activityName} on ${dateStr}`;
      break;
    case "not-scheduled":
      cls += " text-zinc-300 dark:text-zinc-700";
      label = `${activityName} — not scheduled on ${dateStr}`;
      break;
    case "outside":
      // Diagonal-hatched look via repeating linear gradient (inline so we
      // don't need a custom Tailwind utility).
      cls += " text-zinc-300 dark:text-zinc-700";
      label = `${activityName} — not active on ${dateStr}`;
      break;
  }

  if (isToday) {
    cls += " ring-1 ring-zinc-900 dark:ring-zinc-50";
  }

  const style: React.CSSProperties | undefined =
    state === "outside"
      ? {
          backgroundImage:
            "repeating-linear-gradient(45deg, rgb(228 228 231 / 0.6) 0 2px, transparent 2px 6px)",
        }
      : undefined;

  return (
    <Link
      href={`/?view=day&date=${dateStr}`}
      title={label}
      aria-label={label}
      className={cls}
      style={style}
    >
      {inner}
    </Link>
  );
}

function GridLegend() {
  // Plain non-interactive color swatches sized to match a small inline
  // glyph (NOT the full grid cells — those are clickable Links sized to
  // be tappable, which is wrong for legend use).
  const items: Array<{ state: GridCellState; label: string; swatch: string }> = [
    { state: "completed", label: "Done", swatch: "bg-emerald-500" },
    { state: "missed", label: "Missed", swatch: "bg-red-500" },
    {
      state: "overdue",
      label: "Overdue",
      swatch: "bg-amber-300 dark:bg-amber-700",
    },
    {
      state: "scheduled",
      label: "Scheduled",
      swatch:
        "border border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900",
    },
    {
      state: "outside",
      label: "Not active",
      swatch: "",
    },
  ];
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
      {items.map((it) => (
        <span key={it.state} className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className={`inline-block h-3 w-3 rounded ${it.swatch}`}
            style={
              it.state === "outside"
                ? {
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgb(228 228 231 / 0.6) 0 2px, transparent 2px 6px)",
                  }
                : undefined
            }
          />
          {it.label}
        </span>
      ))}
    </p>
  );
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

