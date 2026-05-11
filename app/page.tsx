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
import { createClient } from "@/lib/supabase/server";

import { DateNavigator } from "./_components/date-navigator";
import { InstanceRow } from "./today/instance-row";

type ViewKind = "day" | "week" | "month" | "year";

type Rhythm =
  | { type: "single" }
  | { type: "daily" }
  | { type: "weekdays"; days: string[] }
  | { type: "interval"; days: number }
  | { type: "frequency"; count: number; period: "day" | "week" | "month" };

type PendingInstance = {
  id: string;
  scheduled_for: string;
  activities: {
    id: string;
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    priority: number;
    scheduled_times: string[];
    archived_at: string | null;
  } | null;
  completion_instances: Array<{ completion_id: string }> | null;
};

const VIEW_OPTIONS: ReadonlyArray<{ value: ViewKind; label: string }> = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
];

const WEEK_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TODAY_STR = new Date().toISOString().slice(0, 10);
const DAY_VIEW_HORIZON = 7; // sections shown stacked vertically

// ---------------------------------------------------------------------------

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <SignedOutLanding />;

  const params = await searchParams;
  const view = parseView(params.view);
  const date = parseDateParam(params.date);

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-8 p-6">
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

      {view === "day" && <DayView startDate={date} />}
      {view === "week" && <WeekView weekDate={date} />}
      {view === "month" && <MonthView monthDate={date} />}
      {view === "year" && <YearView yearDate={date} />}
    </main>
  );
}

// ---------------------------------------------------------------------------

function parseView(raw: string | undefined): ViewKind {
  if (raw === "month" || raw === "week" || raw === "year") return raw;
  return "day";
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
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-8 p-6">
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

async function DayView({ startDate }: { startDate: string }) {
  const supabase = await createClient();

  const startD = parseDate(startDate);
  const endStr = format(addDays(startD, DAY_VIEW_HORIZON - 1), "yyyy-MM-dd");
  // Look back enough to catch any overdue singles surfacing on "today".
  const lookbackStr = format(addDays(startD, -60), "yyyy-MM-dd");

  const { data } = await supabase
    .from("activity_instances")
    .select(
      `
      id,
      scheduled_for,
      activities (
        id,
        name,
        notes,
        rhythm,
        priority,
        scheduled_times,
        archived_at
      ),
      completion_instances (
        completion_id
      )
    `
    )
    .eq("status", "pending")
    .gte("scheduled_for", lookbackStr)
    .lte("scheduled_for", endStr)
    .order("scheduled_for");

  const raw = (data ?? []) as unknown as PendingInstance[];
  const live = raw.filter((i) => i.activities && !i.activities.archived_at);

  const prevDate = format(addDays(startD, -1), "yyyy-MM-dd");
  const nextDate = format(addDays(startD, 1), "yyyy-MM-dd");

  const days = Array.from({ length: DAY_VIEW_HORIZON }, (_, i) => {
    const date = addDays(startD, i);
    const dateStr = format(date, "yyyy-MM-dd");
    const visible = live
      .filter((inst) => visibleOnDay(inst, dateStr))
      .sort(compareForDay);
    return { date, dateStr, visible };
  });

  return (
    <div className="flex flex-col gap-3">
      <DateNavigator
        view="day"
        currentDate={startDate}
        prevDate={prevDate}
        nextDate={nextDate}
        label={dayHeaderLabel(startDate)}
      />
      {/* Scroll within a viewport-relative window so the nav above stays
          fixed. New date navigation re-renders the container, which
          naturally starts scrolled to the top. */}
      <div className="max-h-[65vh] min-h-[20rem] overflow-y-auto pr-2">
        <div className="flex flex-col gap-5">
          {days.map((d) => (
            <DaySection key={d.dateStr} {...d} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DaySection({
  date,
  dateStr,
  visible,
}: {
  date: Date;
  dateStr: string;
  visible: PendingInstance[];
}) {
  const isToday = dateStr === TODAY_STR;
  return (
    <section>
      <h2 className="mb-2 flex items-baseline gap-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
        <span>{formatDateMedium(date)}</span>
        {isToday && (
          <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white dark:bg-zinc-50 dark:text-zinc-900">
            Today
          </span>
        )}
      </h2>
      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-3 text-center text-xs text-zinc-500 dark:border-zinc-700">
          Free.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((inst) => {
            const r = inst.activities?.rhythm;
            const isFrequency = r?.type === "frequency";
            const isSingle = r?.type === "single";
            return (
              <InstanceRow
                key={inst.id}
                instanceId={inst.id}
                activityId={inst.activities?.id ?? ""}
                name={inst.activities?.name ?? "Untitled"}
                notes={inst.activities?.notes ?? null}
                priority={inst.activities?.priority ?? 2}
                scheduledFor={inst.scheduled_for}
                scheduledTimes={inst.activities?.scheduled_times ?? []}
                todayStr={TODAY_STR}
                isSingle={isSingle ?? false}
                frequencyTarget={isFrequency ? r.count : null}
                frequencyProgress={
                  isFrequency ? inst.completion_instances?.length ?? 0 : null
                }
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

function visibleOnDay(inst: PendingInstance, dayStr: string): boolean {
  const r = inst.activities?.rhythm;
  if (!r) return false;

  if (r.type === "single") {
    // Overdue singles surface on TODAY only (so the user can act on them
    // without time-traveling); other days show their own scheduled singles.
    if (inst.scheduled_for < TODAY_STR) return dayStr === TODAY_STR;
    return inst.scheduled_for === dayStr;
  }

  if (r.type !== "frequency") return inst.scheduled_for === dayStr;
  if (r.period === "day") return inst.scheduled_for === dayStr;

  const day = parseDate(dayStr);
  const scheduled = parseDate(inst.scheduled_for);
  const periodStart =
    r.period === "week"
      ? startOfWeek(day, { weekStartsOn: 1 })
      : startOfMonth(day);
  return scheduled >= periodStart && scheduled <= day;
}

function compareForDay(a: PendingInstance, b: PendingInstance): number {
  // Time-of-day first if known, then priority high→low, then name.
  const ta = a.activities?.scheduled_times?.[0] ?? "99:99";
  const tb = b.activities?.scheduled_times?.[0] ?? "99:99";
  if (ta !== tb) return ta.localeCompare(tb);
  const pa = a.activities?.priority ?? 2;
  const pb = b.activities?.priority ?? 2;
  if (pa !== pb) return pa - pb;
  return (a.activities?.name ?? "").localeCompare(b.activities?.name ?? "");
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

      <div className="grid grid-cols-7 gap-2">
        {days.map((d) => (
          <Link
            key={d.dateStr}
            href={`/?view=day&date=${d.dateStr}`}
            className={`flex min-h-[8rem] flex-col gap-1 rounded-md border p-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
              d.isToday
                ? "border-zinc-900 dark:border-zinc-50"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <div className="text-center">
              <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                {format(d.date, "EEE")}
              </div>
              <div className={d.isToday ? "font-semibold" : "text-zinc-700 dark:text-zinc-300"}>
                {d.date.getDate()}
              </div>
            </div>
            {d.items.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-[10px] text-zinc-300 dark:text-zinc-700">
                —
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
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
      className={`flex items-start gap-1 rounded px-1.5 py-1 text-[10px] leading-tight ${
        isCompleted
          ? "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-900 dark:text-zinc-600"
          : "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
      }`}
      title={`${item.activities.name}${firstTime ? ` @ ${firstTime}` : ""}`}
    >
      <span
        aria-hidden
        className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block line-clamp-2 font-medium break-words">
          {item.activities.name}
        </span>
        {firstTime && (
          <span className="block opacity-75">{firstTime}</span>
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

  const pendingByDate: Record<string, number> = {};
  const completedByDate: Record<string, number> = {};
  for (const i of (data ?? []) as Array<{
    scheduled_for: string;
    status: string;
  }>) {
    if (i.status === "pending") {
      pendingByDate[i.scheduled_for] = (pendingByDate[i.scheduled_for] ?? 0) + 1;
    } else if (i.status === "completed") {
      completedByDate[i.scheduled_for] = (completedByDate[i.scheduled_for] ?? 0) + 1;
    }
  }

  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    const dateStr = format(date, "yyyy-MM-dd");
    return {
      date,
      dateStr,
      inMonth: date >= monthStart && date <= monthEnd,
      isToday: dateStr === TODAY_STR,
      pendingCount: pendingByDate[dateStr] ?? 0,
      completedCount: completedByDate[dateStr] ?? 0,
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
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-3">
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

function MonthCell({
  date,
  dateStr,
  inMonth,
  isToday,
  pendingCount,
  completedCount,
}: {
  date: Date;
  dateStr: string;
  inMonth: boolean;
  isToday: boolean;
  pendingCount: number;
  completedCount: number;
}) {
  const hasAny = pendingCount > 0 || completedCount > 0;
  let cls =
    "flex aspect-square flex-col items-center justify-start gap-0.5 rounded p-1 text-xs transition-colors";
  if (!inMonth) cls += " text-zinc-400 dark:text-zinc-600";
  else cls += " text-zinc-700 dark:text-zinc-300";
  if (isToday) cls += " ring-1 ring-zinc-900 dark:ring-zinc-50";
  if (hasAny && inMonth) cls += " bg-zinc-100 dark:bg-zinc-900";
  cls += " hover:bg-zinc-200 dark:hover:bg-zinc-800";

  return (
    <Link href={`/?view=day&date=${dateStr}`} className={cls}>
      <span className={isToday ? "font-semibold" : ""}>{date.getDate()}</span>
      {inMonth && pendingCount > 0 && (
        <span className="text-[10px] font-semibold text-zinc-900 dark:text-zinc-50">
          {pendingCount}
        </span>
      )}
      {inMonth && completedCount > 0 && (
        <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
          ✓{completedCount}
        </span>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------

function dayHeaderLabel(yyyyMmDd: string): string {
  const date = parseDate(yyyyMmDd);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateMedium(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
