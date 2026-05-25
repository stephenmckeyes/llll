"use client";

// ---------------------------------------------------------------------------
// FriendCalendar — the friend view's Calendar tab, read-only, with the same
// Day / Week / Month / Year sub-views as the dashboard. Built from the
// friend's shared occurrences (only progress-shared, non-archived rhythms
// have occurrences, so template-only/archived shares simply don't appear
// here — they live in Total).
// ---------------------------------------------------------------------------

import {
  addDays,
  addMonths,
  addYears,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useMemo, useState } from "react";

import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import { DayList as DashboardDayList } from "@/app/_components/day-list";
import type { TagMap } from "@/lib/domain/tags";

import { buildFriendDayData } from "./shared-data";

type Sub = "day" | "week" | "month" | "year";

export function FriendCalendar({
  shares,
  instances,
  todayStr,
  tagMap,
  onOpenActivity,
}: {
  shares: SharedActivity[];
  instances: SharedInstance[];
  todayStr: string;
  tagMap: TagMap;
  /** Open the read-only detail for an activity (clicking a day/week item). */
  onOpenActivity: (activityId: string) => void;
}) {
  const [sub, setSub] = useState<Sub>("day");
  const [refDate, setRefDate] = useState<string>(todayStr);

  const byId = useMemo(
    () => new Map(shares.map((s) => [s.activityId, s])),
    [shares]
  );

  // Day tab reuses the real dashboard DayList (read-only) so the friend
  // gets the exact same infinite-scroll day view.
  const dayData = useMemo(
    () => buildFriendDayData(shares, instances),
    [shares, instances]
  );

  return (
    <div className="flex flex-col gap-3">
      <nav className="flex gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
        {(
          [
            ["day", "Day"],
            ["week", "Week"],
            ["month", "Month"],
            ["year", "Year"],
          ] as const
        ).map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => setSub(val)}
            className={`flex flex-1 items-center justify-center rounded px-3 py-0.5 text-center text-xs font-medium transition-colors ${
              sub === val
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {sub === "day" && (
        <DashboardDayList
          initialDate={todayStr}
          instances={dayData.instances}
          completedByDate={dayData.completedByDate}
          missedByDate={dayData.missedByDate}
          todayStr={todayStr}
          incompleteInfo={{ count: 0, oldestDate: null }}
          tagMap={tagMap}
          readOnly
          onReadOnlyOpen={(inst) => onOpenActivity(inst.activity.id)}
        />
      )}
      {sub === "week" && (
        <WeekGrid
          instances={instances}
          byId={byId}
          todayStr={todayStr}
          refDate={refDate}
          setRefDate={setRefDate}
          onOpenActivity={onOpenActivity}
        />
      )}
      {sub === "month" && (
        <MonthGrid
          instances={instances}
          todayStr={todayStr}
          refDate={refDate}
          setRefDate={setRefDate}
        />
      )}
      {sub === "year" && (
        <YearGrid
          instances={instances}
          refDate={refDate}
          setRefDate={setRefDate}
        />
      )}
    </div>
  );
}

type ById = Map<string, SharedActivity>;

// ---------------------------------------------------------------------------
// Week — 7 columns Mon..Sun, compact name banners per day.
// ---------------------------------------------------------------------------

function WeekGrid({
  instances,
  byId,
  todayStr,
  refDate,
  setRefDate,
  onOpenActivity,
}: {
  instances: SharedInstance[];
  byId: ById;
  todayStr: string;
  refDate: string;
  setRefDate: (s: string) => void;
  onOpenActivity: (activityId: string) => void;
}) {
  const ref = parseYmd(refDate);
  const weekStart = startOfWeek(ref, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(ref, { weekStartsOn: 1 });

  const byDate = useMemo(() => indexByDate(instances), [instances]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const dateStr = format(date, "yyyy-MM-dd");
    // Time-of-day order (no-time last), matching the personal Week view.
    return { date, dateStr, items: sortByTime(byDate.get(dateStr) ?? [], byId) };
  });

  return (
    <div className="flex flex-col gap-3">
      <Nav
        label={`${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`}
        onPrev={() => setRefDate(format(addDays(weekStart, -7), "yyyy-MM-dd"))}
        onNext={() => setRefDate(format(addDays(weekStart, 7), "yyyy-MM-dd"))}
        onToday={() => setRefDate(todayStr)}
      />
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => (
          <div
            key={d.dateStr}
            className={`flex min-h-[7rem] min-w-0 flex-col gap-1 rounded-md border p-1 ${
              d.dateStr === todayStr
                ? "border-zinc-900 dark:border-zinc-50"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <div className="text-center">
              <div className="text-[9px] font-medium uppercase tracking-wide text-zinc-500">
                {format(d.date, "EEE")}
              </div>
              <div
                className={`text-sm ${
                  d.dateStr === todayStr
                    ? "font-semibold"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {d.date.getDate()}
              </div>
            </div>
            {d.items.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-[9px] text-zinc-300 dark:text-zinc-700">
                —
              </div>
            ) : (
              <ul className="flex min-w-0 flex-col gap-0.5">
                {d.items.map((inst) => {
                  const act = byId.get(inst.activityId);
                  const done = inst.status === "completed";
                  return (
                    <li key={inst.instanceId}>
                      <button
                        type="button"
                        onClick={() => onOpenActivity(inst.activityId)}
                        title={act?.name ?? "Activity"}
                        className={`block w-full truncate rounded px-1 py-0.5 text-left text-[9px] leading-tight ${
                          done
                            ? "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-900 dark:text-zinc-600"
                            : inst.status === "missed"
                              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                              : "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                        }`}
                      >
                        {act?.name ?? "Activity"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month — 6-week calendar grid with a per-day count.
// ---------------------------------------------------------------------------

function MonthGrid({
  instances,
  todayStr,
  refDate,
  setRefDate,
}: {
  instances: SharedInstance[];
  todayStr: string;
  refDate: string;
  setRefDate: (s: string) => void;
}) {
  const ref = parseYmd(refDate);
  const monthStart = startOfMonth(ref);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const countByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of instances)
      m.set(i.scheduledFor, (m.get(i.scheduledFor) ?? 0) + 1);
    return m;
  }, [instances]);

  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    const dateStr = format(date, "yyyy-MM-dd");
    return {
      date,
      dateStr,
      inMonth: date.getMonth() === monthStart.getMonth(),
      count: countByDate.get(dateStr) ?? 0,
    };
  });

  return (
    <div className="flex flex-col gap-3">
      <Nav
        label={format(ref, "MMMM yyyy")}
        onPrev={() => setRefDate(format(addMonths(monthStart, -1), "yyyy-MM-dd"))}
        onNext={() => setRefDate(format(addMonths(monthStart, 1), "yyyy-MM-dd"))}
        onToday={() => setRefDate(todayStr)}
      />
      <div className="grid grid-cols-7 gap-1">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div
            key={i}
            className="text-center text-[10px] font-medium text-zinc-400"
          >
            {d}
          </div>
        ))}
        {cells.map((c) => (
          <div
            key={c.dateStr}
            className={`flex min-h-[3.5rem] flex-col items-center gap-1 rounded-md border p-1 ${
              c.dateStr === todayStr
                ? "border-zinc-900 dark:border-zinc-50"
                : "border-zinc-200 dark:border-zinc-800"
            } ${c.inMonth ? "" : "opacity-40"}`}
          >
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {c.date.getDate()}
            </span>
            {c.count > 0 && (
              <span className="rounded-full bg-zinc-900 px-1.5 text-[10px] font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900">
                {c.count}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year — 12-month density (count of shared occurrences per month).
// ---------------------------------------------------------------------------

function YearGrid({
  instances,
  refDate,
  setRefDate,
}: {
  instances: SharedInstance[];
  refDate: string;
  setRefDate: (s: string) => void;
}) {
  const ref = parseYmd(refDate);
  const year = ref.getFullYear();
  const countByMonth = useMemo(() => {
    const arr = new Array(12).fill(0) as number[];
    for (const i of instances) {
      const [y, m] = i.scheduledFor.split("-").map(Number);
      if (y === year) arr[m - 1] += 1;
    }
    return arr;
  }, [instances, year]);

  const max = Math.max(1, ...countByMonth);

  return (
    <div className="flex flex-col gap-3">
      <Nav
        label={String(year)}
        onPrev={() => setRefDate(format(addYears(ref, -1), "yyyy-MM-dd"))}
        onNext={() => setRefDate(format(addYears(ref, 1), "yyyy-MM-dd"))}
        onToday={() => setRefDate(format(new Date(), "yyyy-MM-dd"))}
      />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {countByMonth.map((count, i) => {
          const intensity = count === 0 ? 0 : Math.ceil((count / max) * 3);
          const bg =
            intensity === 0
              ? "bg-zinc-100 dark:bg-zinc-900"
              : intensity === 1
                ? "bg-emerald-200 dark:bg-emerald-900"
                : intensity === 2
                  ? "bg-emerald-400 dark:bg-emerald-700"
                  : "bg-emerald-600 text-white dark:bg-emerald-500";
          return (
            <div
              key={i}
              className={`flex flex-col items-center gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800 ${bg}`}
            >
              <span className="text-xs font-medium">
                {format(new Date(year, i, 1), "MMM")}
              </span>
              <span className="text-sm font-semibold tabular-nums">{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Nav({
  label,
  onPrev,
  onNext,
  onToday,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous"
        className="rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        ←
      </button>
      <span className="min-w-[10rem] text-center text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </span>
      <button
        type="button"
        onClick={onNext}
        aria-label="Next"
        className="rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        →
      </button>
      <button
        type="button"
        onClick={onToday}
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
      >
        Today
      </button>
    </div>
  );
}

// Sort a day's occurrences by the activity's first time of day (08:00
// before 10:00 …), activities with NO set time last, then priority, then
// name. Mirrors the personal Day/Week ordering.
function sortByTime(items: SharedInstance[], byId: ById): SharedInstance[] {
  return [...items].sort((a, b) => {
    const aa = byId.get(a.activityId);
    const bb = byId.get(b.activityId);
    const ta = aa?.scheduledTimes[0] ?? "99:99";
    const tb = bb?.scheduledTimes[0] ?? "99:99";
    if (ta !== tb) return ta.localeCompare(tb);
    const pa = aa?.priority ?? 2;
    const pb = bb?.priority ?? 2;
    if (pa !== pb) return pa - pb;
    return (aa?.name ?? "").localeCompare(bb?.name ?? "");
  });
}

function indexByDate(
  instances: SharedInstance[]
): Map<string, SharedInstance[]> {
  const m = new Map<string, SharedInstance[]>();
  for (const i of instances) {
    const arr = m.get(i.scheduledFor);
    if (arr) arr.push(i);
    else m.set(i.scheduledFor, [i]);
  }
  return m;
}

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}
