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
import { useEffect, useMemo, useState } from "react";

import type { YearCountsByDate } from "@/app/actions/calendar-fetch";
import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import { DayList as DashboardDayList } from "@/app/_components/day-list";
import { IncompleteButton } from "@/app/_components/incomplete-button";
import {
  MONTH_BANNERS_PER_CELL,
  MonthBannerPill,
  summarizeOverflow,
  type MonthBanner,
} from "@/app/_components/month-cell";
import { SwipeNav } from "@/app/_components/swipe-nav";
import { WeekBannerPill } from "@/app/_components/week-banner";
import { YearMiniMonths } from "@/app/_components/year-mini-months";
import {
  isPastDuePending,
  unlabeledLandingDay,
} from "@/lib/domain/frequency-period";
import type { TagMap } from "@/lib/domain/tags";

import {
  buildFriendDayData,
  occurrenceStatusLabel,
  type Occurrence,
} from "./shared-data";

type Sub = "day" | "week" | "month" | "year";

export function FriendCalendar({
  shares,
  instances,
  todayStr,
  tagMap,
  onOpenActivity,
  loadYearCounts,
}: {
  shares: SharedActivity[];
  instances: SharedInstance[];
  todayStr: string;
  tagMap: TagMap;
  /** Open the read-only detail for a specific occurrence (date + status). */
  onOpenActivity: (activityId: string, occurrence: Occurrence | null) => void;
  /** Optional full-year per-day counts loader for the rich Year view. When
   *  absent, Year is computed from the loaded `instances` window. */
  loadYearCounts?: (yearStart: string) => Promise<YearCountsByDate>;
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

  // Unlabeled chip data — mirrors fetchIncompleteInfo on the dashboard,
  // computed here from the already-shared instances + shares. Non-
  // frequency: past-due if scheduledFor < today AND status='pending'.
  // Frequency: past-due only once the whole period has closed
  // (isPastDuePending handles both). For frequency, the "landing day"
  // (where we should jump) is the period end, not scheduledFor.
  const incompleteInfo = useMemo(() => {
    let count = 0;
    let oldest: string | null = null;
    for (const inst of instances) {
      if (inst.status !== "pending") continue;
      if (inst.scheduledFor >= todayStr) continue;
      const rh = byId.get(inst.activityId)?.rhythm;
      if (!rh) continue;
      if (!isPastDuePending(inst.scheduledFor, rh, todayStr)) continue;
      const landing = unlabeledLandingDay(inst.scheduledFor, rh);
      count += 1;
      if (oldest === null || landing < oldest) oldest = landing;
    }
    return { count, oldestDate: oldest };
  }, [instances, byId, todayStr]);

  const jumpToDay = (date: string) => {
    setSub("day");
    setRefDate(date);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <nav className="flex flex-1 gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
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
        {/* Unlabeled chip — same styling as the personal view. Clicking
            jumps into THIS friend's Day sub-view at their oldest past-
            due date. On the Day sub-view the DayList renders its own
            chip inside its date navigator, so skip this outer copy to
            avoid the duplicate. */}
        {sub !== "day" && (
          <IncompleteButton info={incompleteInfo} onJump={jumpToDay} />
        )}
      </div>

      {sub === "day" && (
        <DashboardDayList
          initialDate={refDate}
          instances={dayData.instances}
          completedByDate={dayData.completedByDate}
          missedByDate={dayData.missedByDate}
          todayStr={todayStr}
          incompleteInfo={incompleteInfo}
          tagMap={tagMap}
          readOnly
          onReadOnlyOpen={(inst) =>
            onOpenActivity(inst.activity.id, {
              scheduledFor: inst.scheduled_for,
              statusLabel: occurrenceStatusLabel(
                inst.status,
                inst.scheduled_for,
                todayStr
              ),
              comment: inst.comment,
            })
          }
          onUnlabeledJump={jumpToDay}
        />
      )}
      {sub === "week" && (
        <WeekGrid
          instances={instances}
          byId={byId}
          tagMap={tagMap}
          todayStr={todayStr}
          refDate={refDate}
          setRefDate={setRefDate}
          onOpenActivity={onOpenActivity}
        />
      )}
      {sub === "month" && (
        <MonthGrid
          instances={instances}
          byId={byId}
          tagMap={tagMap}
          todayStr={todayStr}
          refDate={refDate}
          setRefDate={setRefDate}
          onJumpToDay={jumpToDay}
        />
      )}
      {sub === "year" && (
        <YearGrid
          instances={instances}
          todayStr={todayStr}
          refDate={refDate}
          setRefDate={setRefDate}
          loadYearCounts={loadYearCounts}
          onMonthClick={(monthDateStr) => {
            setRefDate(monthDateStr);
            setSub("month");
          }}
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
  tagMap,
  todayStr,
  refDate,
  setRefDate,
  onOpenActivity,
}: {
  instances: SharedInstance[];
  byId: ById;
  tagMap: TagMap;
  todayStr: string;
  refDate: string;
  setRefDate: (s: string) => void;
  onOpenActivity: (activityId: string, occurrence: Occurrence | null) => void;
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
      <SwipeNav
        onPrev={() => setRefDate(format(addDays(weekStart, -7), "yyyy-MM-dd"))}
        onNext={() => setRefDate(format(addDays(weekStart, 7), "yyyy-MM-dd"))}
        className="grid grid-cols-7 gap-1"
      >
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
                  const status =
                    inst.status === "completed"
                      ? "completed"
                      : inst.status === "missed"
                        ? "missed"
                        : "pending";
                  return (
                    <li key={inst.instanceId}>
                      <button
                        type="button"
                        onClick={() =>
                          onOpenActivity(inst.activityId, {
                            scheduledFor: inst.scheduledFor,
                            statusLabel: occurrenceStatusLabel(
                              inst.status,
                              inst.scheduledFor,
                              todayStr
                            ),
                            comment: inst.comment,
                          })
                        }
                        className="block w-full min-w-0 text-left"
                      >
                        <WeekBannerPill
                          name={act?.name ?? "Activity"}
                          firstTime={act?.scheduledTimes?.[0]}
                          tags={act?.defaultSkillTags ?? []}
                          status={status}
                          tagMap={tagMap}
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </SwipeNav>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month — 6-week calendar grid with a per-day count.
// ---------------------------------------------------------------------------

function MonthGrid({
  instances,
  byId,
  tagMap,
  todayStr,
  refDate,
  setRefDate,
  onJumpToDay,
}: {
  instances: SharedInstance[];
  byId: ById;
  tagMap: TagMap;
  todayStr: string;
  refDate: string;
  setRefDate: (s: string) => void;
  onJumpToDay: (date: string) => void;
}) {
  const ref = parseYmd(refDate);
  const monthStart = startOfMonth(ref);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });

  // Name banners per day, colored by first tag — matches the personal
  // Month view (MonthCell). Time-of-day order within a day.
  const bannersByDate = useMemo(() => {
    const m = new Map<string, MonthBanner[]>();
    for (const inst of sortByTime(instances, byId)) {
      const act = byId.get(inst.activityId);
      const banner: MonthBanner = {
        id: inst.instanceId,
        name: act?.name ?? "Activity",
        status: inst.status,
        tags: act?.defaultSkillTags ?? [],
      };
      const arr = m.get(inst.scheduledFor);
      if (arr) arr.push(banner);
      else m.set(inst.scheduledFor, [banner]);
    }
    return m;
  }, [instances, byId]);

  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    const dateStr = format(date, "yyyy-MM-dd");
    return {
      date,
      dateStr,
      inMonth: date.getMonth() === monthStart.getMonth(),
      banners: bannersByDate.get(dateStr) ?? [],
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
        {cells.map((c) => {
          const visible = c.banners.slice(0, MONTH_BANNERS_PER_CELL);
          const hidden = c.banners.slice(MONTH_BANNERS_PER_CELL);
          const overflow = hidden.length > 0 ? summarizeOverflow(hidden) : null;
          return (
            <button
              key={c.dateStr}
              type="button"
              onClick={() => onJumpToDay(c.dateStr)}
              className={`flex min-h-20 flex-col gap-0.5 rounded-md border p-1 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                c.dateStr === todayStr
                  ? "border-zinc-900 dark:border-zinc-50"
                  : "border-zinc-200 dark:border-zinc-800"
              } ${c.inMonth ? "" : "opacity-40"}`}
            >
              <span
                className={`self-start text-xs ${
                  c.dateStr === todayStr
                    ? "font-semibold"
                    : "text-zinc-600 dark:text-zinc-400"
                }`}
              >
                {c.date.getDate()}
              </span>
              {c.inMonth && c.banners.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  {visible.map((b) => (
                    <MonthBannerPill key={b.id} banner={b} tagMap={tagMap} />
                  ))}
                  {overflow && (
                    <span className="truncate text-[9px] font-medium text-zinc-500 dark:text-zinc-400">
                      {overflow}
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year — 12-month density (count of shared occurrences per month).
// ---------------------------------------------------------------------------

function YearGrid({
  instances,
  todayStr,
  refDate,
  setRefDate,
  loadYearCounts,
  onMonthClick,
}: {
  instances: SharedInstance[];
  todayStr: string;
  refDate: string;
  setRefDate: (s: string) => void;
  loadYearCounts?: (yearStart: string) => Promise<YearCountsByDate>;
  onMonthClick: (monthDateStr: string) => void;
}) {
  const ref = parseYmd(refDate);
  const year = ref.getFullYear();
  const yearStart = `${year}-01-01`;

  // Fallback: per-day counts from the loaded instance window (used when no
  // full-year loader is supplied, e.g. the friend view).
  const fallbackCounts = useMemo(() => {
    const m: YearCountsByDate = {};
    for (const i of instances) {
      if (Number(i.scheduledFor.slice(0, 4)) !== year) continue;
      const cur = m[i.scheduledFor] ?? { pending: 0, completed: 0 };
      if (i.status === "completed") cur.completed += 1;
      else cur.pending += 1;
      m[i.scheduledFor] = cur;
    }
    return m;
  }, [instances, year]);

  // Full-year counts loaded on demand (community calendar).
  const [loaded, setLoaded] = useState<Record<string, YearCountsByDate>>({});
  useEffect(() => {
    if (!loadYearCounts || loaded[yearStart]) return;
    let alive = true;
    loadYearCounts(yearStart)
      .then((c) => {
        if (alive) setLoaded((prev) => ({ ...prev, [yearStart]: c }));
      })
      .catch(() => {
        /* fall back to window counts */
      });
    return () => {
      alive = false;
    };
  }, [loadYearCounts, yearStart, loaded]);

  const counts = loadYearCounts ? loaded[yearStart] ?? {} : fallbackCounts;

  return (
    <div className="flex flex-col gap-3">
      <Nav
        label={String(year)}
        onPrev={() => setRefDate(format(addYears(ref, -1), "yyyy-MM-dd"))}
        onNext={() => setRefDate(format(addYears(ref, 1), "yyyy-MM-dd"))}
        onToday={() => setRefDate(format(new Date(), "yyyy-MM-dd"))}
      />
      <YearMiniMonths
        year={year}
        countsByDate={counts}
        todayStr={todayStr}
        onMonthClick={onMonthClick}
      />
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
