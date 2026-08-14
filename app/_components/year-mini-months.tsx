"use client";

// ---------------------------------------------------------------------------
// YearMiniMonths — the shared Year-view atom: one year as a 3-col grid of 12
// mini-month dot-grids. Used by the personal dashboard Year (endless-scroll,
// lazy-loaded) and the friend/community Year, so both look identical.
//
// Navigation is per-surface: pass `monthHref` to render each month as a Link
// (personal → /?view=month), or `onMonthClick` to render a button (friend/
// community → jump to their Month sub-view).
// ---------------------------------------------------------------------------

import { addDays, endOfMonth, format, startOfWeek } from "date-fns";
import Link from "next/link";

import type { YearCountsByDate } from "@/app/actions/calendar-fetch";

export function YearMiniMonths({
  year,
  countsByDate,
  todayStr,
  monthHref,
  onMonthClick,
}: {
  year: number;
  countsByDate: YearCountsByDate;
  todayStr: string;
  monthHref?: (monthDateStr: string) => string;
  onMonthClick?: (monthDateStr: string) => void;
}) {
  const months = Array.from({ length: 12 }, (_, m) => new Date(year, m, 1));
  return (
    <div className="grid grid-cols-3 gap-4">
      {months.map((monthStart, i) => (
        <MiniMonth
          key={i}
          monthStart={monthStart}
          byDate={countsByDate}
          todayStr={todayStr}
          monthHref={monthHref}
          onMonthClick={onMonthClick}
        />
      ))}
    </div>
  );
}

function MiniMonth({
  monthStart,
  byDate,
  todayStr,
  monthHref,
  onMonthClick,
}: {
  monthStart: Date;
  byDate: YearCountsByDate;
  todayStr: string;
  monthHref?: (monthDateStr: string) => string;
  onMonthClick?: (monthDateStr: string) => void;
}) {
  const monthEnd = endOfMonth(monthStart);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const monthDateStr = format(monthStart, "yyyy-MM-dd");
  const monthLabel = monthStart.toLocaleString(undefined, { month: "long" });

  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    const dateStr = format(date, "yyyy-MM-dd");
    const inMonth = date >= monthStart && date <= monthEnd;
    const c = byDate[dateStr] ?? { pending: 0, completed: 0 };
    return {
      date,
      dateStr,
      inMonth,
      isToday: dateStr === todayStr,
      hasActivity: inMonth && (c.pending > 0 || c.completed > 0),
    };
  });

  const cls =
    "flex flex-col gap-1.5 rounded-md border border-zinc-200 p-2 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900";

  const inner = (
    <>
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
    </>
  );

  if (monthHref) {
    return (
      <Link href={monthHref(monthDateStr)} className={cls}>
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onMonthClick?.(monthDateStr)}
      className={`${cls} text-left`}
    >
      {inner}
    </button>
  );
}
