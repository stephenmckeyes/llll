// ---------------------------------------------------------------------------
// Home — the Mission dashboard.
//
// Logged out: marketing-y landing with sign-in / sign-up CTAs.
// Logged in:  calendar dashboard with a view switcher.
//   - ?view=day   (default) — list of today's pending activities
//   - ?view=week            — 7-day grid with banners per day
//   - ?view=month           — month calendar grid with counts per day
// (?view=year lands in Phase 2c.)
// ---------------------------------------------------------------------------

import {
  addDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import Link from "next/link";

import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";

import { InstanceRow } from "./today/instance-row";

type ViewKind = "day" | "week" | "month";

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
];

const WEEK_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TODAY_STR = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------

export default async function HomePage({
  searchParams,
}: {
  // Next.js 16: searchParams is async.
  searchParams: Promise<{ view?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <SignedOutLanding />;

  const params = await searchParams;
  const view: ViewKind =
    params.view === "month"
      ? "month"
      : params.view === "week"
        ? "week"
        : "day";

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

        <ViewSwitcher current={view} />
      </header>

      {view === "day" && <DayView />}
      {view === "week" && <WeekView />}
      {view === "month" && <MonthView />}
    </main>
  );
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

function ViewSwitcher({ current }: { current: ViewKind }) {
  return (
    <nav
      className="flex gap-1 rounded-md border border-zinc-200 p-1 dark:border-zinc-800"
      aria-label="View"
    >
      {VIEW_OPTIONS.map((opt) => {
        const active = opt.value === current;
        return (
          <Link
            key={opt.value}
            href={opt.value === "day" ? "/" : `/?view=${opt.value}`}
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
      {/* Year button reserved for the next pass — disabled stub. */}
      <span className="flex-1 rounded px-3 py-1 text-center text-sm font-medium text-zinc-300 dark:text-zinc-700">
        Year
      </span>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Day view — replicates the old /today page.
// ---------------------------------------------------------------------------

async function DayView() {
  const supabase = await createClient();

  const today = TODAY_STR;
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 60);
  const windowStartStr = windowStart.toISOString().slice(0, 10);

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
    .gte("scheduled_for", windowStartStr)
    .lte("scheduled_for", today)
    .order("scheduled_for");

  const raw = (data ?? []) as unknown as PendingInstance[];
  const visible = raw
    .filter((inst) => inst.activities && !inst.activities.archived_at)
    .filter((inst) => visibleOnToday(inst, today))
    .sort(compareForToday);

  if (visible.length === 0) {
    return (
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          {formatDateLong(today)}
        </h2>
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nothing for today.{" "}
          <Link
            href="/activities/new"
            className="font-medium underline-offset-2 hover:underline"
          >
            Add your first activity
          </Link>
          .
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
        {formatDateLong(today)}
      </h2>
      <ul className="flex flex-col gap-2">
        {visible.map((inst) => {
          const r = inst.activities?.rhythm;
          const isFrequency = r?.type === "frequency";
          const isSingle = r?.type === "single";
          return (
            <InstanceRow
              key={inst.id}
              instanceId={inst.id}
              name={inst.activities?.name ?? "Untitled"}
              notes={inst.activities?.notes ?? null}
              priority={inst.activities?.priority ?? 2}
              scheduledFor={inst.scheduled_for}
              scheduledTimes={inst.activities?.scheduled_times ?? []}
              todayStr={today}
              isSingle={isSingle ?? false}
              frequencyTarget={isFrequency ? r.count : null}
              frequencyProgress={
                isFrequency ? inst.completion_instances?.length ?? 0 : null
              }
            />
          );
        })}
      </ul>
    </section>
  );
}

function visibleOnToday(inst: PendingInstance, todayStr: string): boolean {
  const r = inst.activities?.rhythm;
  if (!r) return false;
  if (r.type === "single") return inst.scheduled_for <= todayStr;
  if (r.type !== "frequency") return inst.scheduled_for === todayStr;
  if (r.period === "day") return inst.scheduled_for === todayStr;

  const today = parseDate(todayStr);
  const scheduled = parseDate(inst.scheduled_for);
  const periodStart =
    r.period === "week"
      ? startOfWeek(today, { weekStartsOn: 1 })
      : startOfMonth(today);
  return scheduled >= periodStart && scheduled <= today;
}

function compareForToday(a: PendingInstance, b: PendingInstance): number {
  const aOverdue =
    a.activities?.rhythm.type === "single" && a.scheduled_for < TODAY_STR;
  const bOverdue =
    b.activities?.rhythm.type === "single" && b.scheduled_for < TODAY_STR;
  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
  const pa = a.activities?.priority ?? 2;
  const pb = b.activities?.priority ?? 2;
  if (pa !== pb) return pa - pb;
  return (a.activities?.name ?? "").localeCompare(b.activities?.name ?? "");
}

// ---------------------------------------------------------------------------
// Week view — 7 columns, current Monday-Sunday week. Each column shows
// the day's pending activities as banners (the format we want everywhere
// eventually; see BACKLOG). Today's column is highlighted.
//
// Each banner shows: name + first scheduled time (if any) + a priority
// dot. For frequency rhythms, the banner appears on the period's anchor
// day only (Monday for week, 1st-of-month for month) — keeps banners
// from duplicating across every day they're "current" for.
// ---------------------------------------------------------------------------

async function WeekView() {
  const supabase = await createClient();

  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
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

  // Group by date — each banner shows on its scheduled_for cell only.
  // Skip instances whose activity has been archived.
  const byDate: Record<string, WeekInstance[]> = {};
  for (const i of all) {
    if (!i.activities || i.activities.archived_at) continue;
    (byDate[i.scheduled_for] ??= []).push(i);
  }

  // Sort each day's banners: pending first, then priority high→low, then
  // earliest scheduled time, then name.
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

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
      </h2>

      <div className="grid grid-cols-7 gap-2">
        {days.map((d) => (
          <div
            key={d.dateStr}
            className={`flex min-h-[8rem] flex-col gap-1 rounded-md border p-2 ${
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
          </div>
        ))}
      </div>
    </section>
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
        <span className="block line-clamp-2 font-medium">{item.activities.name}</span>
        {firstTime && (
          <span className="block opacity-75">{firstTime}</span>
        )}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Month view — calendar grid for the current month, with per-day pending
// counts. Click a date to jump to that day's view (deferred to 2c).
// ---------------------------------------------------------------------------

async function MonthView() {
  const supabase = await createClient();

  const todayDate = new Date();
  const monthStart = startOfMonth(todayDate);
  const monthEnd = endOfMonth(todayDate);

  const { data } = await supabase
    .from("activity_instances")
    .select(
      "id, scheduled_for, status, activities!inner(archived_at)"
    )
    .gte("scheduled_for", format(monthStart, "yyyy-MM-dd"))
    .lte("scheduled_for", format(monthEnd, "yyyy-MM-dd"))
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

  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
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

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
        {format(todayDate, "MMMM yyyy")}
      </h2>

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

      <p className="text-xs text-zinc-500">
        Numbers in each cell show pending (top) and completed (bottom) for
        that day. Click navigation per day arrives in the next pass.
      </p>
    </section>
  );
}

function MonthCell({
  date,
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
    "flex aspect-square flex-col items-center justify-start gap-0.5 rounded p-1 text-xs";
  if (!inMonth) cls += " text-zinc-300 dark:text-zinc-700";
  else cls += " text-zinc-700 dark:text-zinc-300";
  if (isToday) cls += " ring-1 ring-zinc-900 dark:ring-zinc-50";
  if (hasAny && inMonth) cls += " bg-zinc-100 dark:bg-zinc-900";

  return (
    <div className={cls}>
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
    </div>
  );
}

// ---------------------------------------------------------------------------

function parseDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateLong(yyyyMmDd: string): string {
  return parseDate(yyyyMmDd).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
