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

import type {
  YearCountsByDate,
  MonthBannersByDate,
} from "@/app/actions/calendar-fetch";
import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import { DayList as DashboardDayList } from "@/app/_components/day-list";
import { MonthList } from "@/app/_components/month-list";
import { YearList } from "@/app/_components/year-list";
import { IncompleteButton } from "@/app/_components/incomplete-button";
import type {
  CollectiveHandlers,
  AggregateHandlers,
} from "@/app/_components/instance-row";
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
import { tagChipClasses, type TagMap } from "@/lib/domain/tags";

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
  monthLoader,
  endless = false,
  collective,
  aggregate,
  fillHeight = false,
}: {
  shares: SharedActivity[];
  instances: SharedInstance[];
  todayStr: string;
  tagMap: TagMap;
  /** Open the read-only detail for a specific occurrence (date + status). */
  onOpenActivity: (activityId: string, occurrence: Occurrence | null) => void;
  /** Optional full-year per-day counts loader for the rich Year view. When
   *  absent, Year is computed from the loaded `instances` window. Doubles as
   *  the endless-scroll Year loader when `endless` is on. */
  loadYearCounts?: (yearStart: string) => Promise<YearCountsByDate>;
  /** Per-month banner loader for the endless-scroll Month view. Required for
   *  `endless` Month; ignored otherwise. */
  monthLoader?: (monthKey: string) => Promise<MonthBannersByDate>;
  /** Use the SAME endless-scroll Month/Year engine as the personal
   *  dashboard (MonthList / YearList) instead of the single-window
   *  grids. The community calendar sets this (it has full-history
   *  loaders); the friend view leaves it off (data-limited to a window). */
  endless?: boolean;
  /** Collective-completion handlers (community calendar). When set, the Day
   *  sub-view renders inline Complete/Missed wired to these. */
  collective?: CollectiveHandlers;
  /** Aggregate-completion handlers (community calendar). Rows whose activity
   *  is 'aggregate' render per-member N/M marking instead. */
  aggregate?: AggregateHandlers;
  /** App-shell mode: fill the bounded parent so the header/sub-tabs pin
   *  and only the calendar body scrolls (Day list gets fillHeight).
   *  Default false keeps the friend view's natural-height layout. */
  fillHeight?: boolean;
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
    <div
      className={`flex flex-col gap-3 ${
        fillHeight ? "min-h-0 flex-1" : ""
      }`}
    >
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
          fillHeight={fillHeight}
          collective={collective}
          aggregate={aggregate}
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
      {/* Week keeps the single-window grid (both friend + community). In
          app-shell mode it gets a fill-height scroll wrapper so the sub-tabs
          below stay pinned. (Day uses the DayList's own fillHeight scroll.) */}
      {sub === "week" && (
        <div
          className={
            fillHeight ? "min-h-0 flex-1 overflow-y-auto overflow-x-hidden" : ""
          }
        >
          <WeekGrid
            instances={instances}
            byId={byId}
            tagMap={tagMap}
            todayStr={todayStr}
            refDate={refDate}
            setRefDate={setRefDate}
            onOpenActivity={onOpenActivity}
          />
        </div>
      )}

      {/* Month — the SAME endless-scroll engine as the personal dashboard
          (MonthList) when a full-history loader is available (community);
          the single-window MonthGrid otherwise (friend). MonthList brings
          its own header + internal scroll, so it isn't wrapped. */}
      {sub === "month" &&
        (endless && monthLoader ? (
          <MonthList
            key={`m-${refDate}`}
            initialMonth={format(startOfMonth(parseYmd(refDate)), "yyyy-MM-01")}
            initialData={{}}
            todayStr={todayStr}
            tagMap={tagMap}
            hiddenTags={[]}
            loadMonth={monthLoader}
            onDaySelect={jumpToDay}
            syncUrl={false}
            onDrillUp={(yr) => {
              setRefDate(`${yr}-01-01`);
              setSub("year");
            }}
            onOutOfWindow={(mk) => setRefDate(mk)}
          />
        ) : (
          <div
            className={
              fillHeight ? "min-h-0 flex-1 overflow-y-auto overflow-x-hidden" : ""
            }
          >
            <MonthGrid
              instances={instances}
              byId={byId}
              tagMap={tagMap}
              todayStr={todayStr}
              refDate={refDate}
              setRefDate={setRefDate}
              onJumpToDay={jumpToDay}
            />
          </div>
        ))}

      {/* Year — endless-scroll YearList (community, with a full-year loader)
          or the single-window YearGrid (friend). */}
      {sub === "year" &&
        (endless && loadYearCounts ? (
          <YearList
            key={`y-${refDate.slice(0, 4)}`}
            initialYear={`${refDate.slice(0, 4)}-01-01`}
            initialData={{}}
            todayStr={todayStr}
            hiddenTags={[]}
            loadYear={loadYearCounts}
            onMonthSelect={(monthDateStr) => {
              setRefDate(monthDateStr);
              setSub("month");
            }}
            syncUrl={false}
            onOutOfWindow={(yk) => setRefDate(yk)}
          />
        ) : (
          <div
            className={
              fillHeight ? "min-h-0 flex-1 overflow-y-auto overflow-x-hidden" : ""
            }
          >
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
          </div>
        ))}

      {/* Sub-tabs pinned at the BOTTOM (shrink-0), reversed left-to-right,
          matching the personal dashboard's bottom-anchored view switcher.
          The Unlabeled chip rides on the same row (skipped on Day, where
          the DayList renders its own inside the date navigator). */}
      <div className="mt-auto flex shrink-0 items-center gap-2 pt-1">
        <nav className="flex flex-1 flex-row-reverse gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
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
        {sub !== "day" && (
          <IncompleteButton info={incompleteInfo} onJump={jumpToDay} />
        )}
      </div>
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

  // A shared multi-day event: a "Once" activity whose end_date is after its
  // start. Rendered as a connected bar across its days (same as personal).
  const isShareSpan = (inst: SharedInstance): boolean => {
    const a = byId.get(inst.activityId);
    return (
      !!a &&
      a.rhythm.type === "single" &&
      !!a.endDate &&
      !!a.startDate &&
      a.endDate > a.startDate
    );
  };

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const dateStr = format(date, "yyyy-MM-dd");
    // Spans first (stable by start+activity so a bar keeps one lane across
    // days), then the usual time-of-day order.
    const items = sortByTime(byDate.get(dateStr) ?? [], byId).slice();
    items.sort((a, b) => {
      const sa = isShareSpan(a);
      const sb = isShareSpan(b);
      if (sa !== sb) return sa ? -1 : 1;
      if (sa && sb) {
        const aa = byId.get(a.activityId);
        const bb = byId.get(b.activityId);
        const s = (aa?.startDate ?? "").localeCompare(bb?.startDate ?? "");
        if (s !== 0) return s;
        return a.activityId.localeCompare(b.activityId);
      }
      return 0; // keep sortByTime order for non-spans (stable sort)
    });
    return { date, dateStr, items };
  });

  // Multi-day events → connected OVERLAY bars above the cell grid (mirrors
  // the personal WeekView). Aggregate each span's run within the week + lanes.
  const spanAgg = new Map<
    string,
    { startCol: number; endCol: number; name: string; start: string; end: string | null }
  >();
  days.forEach((d, di) => {
    for (const inst of d.items) {
      if (!isShareSpan(inst)) continue;
      const a = byId.get(inst.activityId);
      if (!a) continue;
      const ex = spanAgg.get(inst.activityId);
      if (ex) {
        ex.startCol = Math.min(ex.startCol, di);
        ex.endCol = Math.max(ex.endCol, di);
      } else {
        spanAgg.set(inst.activityId, {
          startCol: di,
          endCol: di,
          name: a.name,
          start: a.startDate,
          end: a.endDate,
        });
      }
    }
  });
  const laneEnds: number[] = [];
  const weekSpans = [...spanAgg.entries()]
    .map(([activityId, v]) => ({ activityId, ...v }))
    .sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol)
    .map((s) => {
      let lane = laneEnds.findIndex((e) => e < s.startCol);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(s.endCol);
      } else {
        laneEnds[lane] = s.endCol;
      }
      return {
        activityId: s.activityId,
        name: s.name,
        startCol: s.startCol,
        endCol: s.endCol,
        continuesLeft: s.start < days[0].dateStr,
        continuesRight: !!s.end && s.end > days[6].dateStr,
        lane,
      };
    });
  const spanLaneCount = laneEnds.length;
  const nonSpanByDay = days.map((d) => d.items.filter((i) => !isShareSpan(i)));
  const WEEK_LANE_H = 18;
  const WEEK_SPAN_TOP = 44;

  return (
    <div className="flex flex-col gap-3">
      <Nav
        label={`${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`}
        onPrev={() => setRefDate(format(addDays(weekStart, -7), "yyyy-MM-dd"))}
        onNext={() => setRefDate(format(addDays(weekStart, 7), "yyyy-MM-dd"))}
        onToday={() => setRefDate(todayStr)}
      />
      <div className="relative">
        <SwipeNav
          onPrev={() => setRefDate(format(addDays(weekStart, -7), "yyyy-MM-dd"))}
          onNext={() => setRefDate(format(addDays(weekStart, 7), "yyyy-MM-dd"))}
          className="grid grid-cols-7 gap-1"
        >
          {days.map((d, di) => (
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
              {spanLaneCount > 0 && (
                <div aria-hidden style={{ height: spanLaneCount * WEEK_LANE_H }} />
              )}
              {nonSpanByDay[di].length > 0 ? (
                <ul className="flex min-w-0 flex-col gap-0.5">
                  {nonSpanByDay[di].map((inst) => {
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
              ) : (
                spanLaneCount === 0 && (
                  <div className="flex flex-1 items-center justify-center text-[9px] text-zinc-300 dark:text-zinc-700">
                    —
                  </div>
                )
              )}
            </div>
          ))}
        </SwipeNav>

        {/* Multi-day span bars overlaid on the cell grid — one grid item per
            span, spanning its columns (and their gaps) → a continuous bar. */}
        {weekSpans.length > 0 && (
          <div
            className="absolute inset-x-0 grid grid-cols-7 gap-1"
            style={{ top: WEEK_SPAN_TOP, gridAutoRows: `${WEEK_LANE_H}px` }}
          >
            {weekSpans.map((s) => (
              <button
                key={s.activityId}
                type="button"
                title={s.name}
                onClick={() => onOpenActivity(s.activityId, null)}
                style={{
                  gridColumn: `${s.startCol + 1} / span ${s.endCol - s.startCol + 1}`,
                  gridRowStart: s.lane + 1,
                }}
                className={`mx-0.5 h-4 overflow-hidden truncate px-1 text-left text-[9px] font-medium leading-4 bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900 ${
                  s.continuesLeft ? "rounded-l-none" : "rounded-l"
                } ${s.continuesRight ? "rounded-r-none" : "rounded-r"}`}
              >
                {s.continuesLeft ? " " : s.name}
              </button>
            ))}
          </div>
        )}
      </div>
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
  // Month view (MonthCell). Multi-day events (a "Once" activity whose
  // end_date > start_date) are tagged with span info so they render as a
  // connected bar across their days.
  const bannersByDate = useMemo(() => {
    const m = new Map<string, MonthBanner[]>();
    for (const inst of sortByTime(instances, byId)) {
      const act = byId.get(inst.activityId);
      const isSpan =
        !!act &&
        act.rhythm.type === "single" &&
        !!act.endDate &&
        !!act.startDate &&
        act.endDate > act.startDate;
      const banner: MonthBanner = {
        id: inst.instanceId,
        name: act?.name ?? "Activity",
        status: inst.status,
        tags: act?.defaultSkillTags ?? [],
        activityId: inst.activityId,
        ...(isSpan
          ? { spanStart: act!.startDate, spanEnd: act!.endDate! }
          : {}),
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
    const all = bannersByDate.get(dateStr) ?? [];
    return {
      date,
      dateStr,
      inMonth: date.getMonth() === monthStart.getMonth(),
      // Single-day pills stay in the cell; multi-day events become overlay
      // bars (see per-week spans below).
      nonSpan: all.filter((b) => !b.spanStart),
      spans: all.filter((b) => b.spanStart),
    };
  });

  const MONTH_LANE_H = 15; // px per span lane
  const MONTH_SPAN_TOP = 22; // px below the day number where lanes begin

  // Per-week span segments → connected overlay bars (split at week edges,
  // greedy lane stacking), mirroring the Week overlay.
  const weeks = Array.from({ length: 6 }, (_, w) => {
    const weekCells = cells.slice(w * 7, w * 7 + 7);
    const weekFirst = weekCells[0].dateStr;
    const weekLast = weekCells[6].dateStr;
    const agg = new Map<
      string,
      {
        startCol: number;
        endCol: number;
        name: string;
        tags: string[];
        spanStart: string;
        spanEnd: string;
      }
    >();
    weekCells.forEach((c, col) => {
      for (const b of c.spans) {
        if (!b.activityId || !b.spanStart || !b.spanEnd) continue;
        const ex = agg.get(b.activityId);
        if (ex) {
          ex.startCol = Math.min(ex.startCol, col);
          ex.endCol = Math.max(ex.endCol, col);
        } else {
          agg.set(b.activityId, {
            startCol: col,
            endCol: col,
            name: b.name,
            tags: b.tags,
            spanStart: b.spanStart,
            spanEnd: b.spanEnd,
          });
        }
      }
    });
    const laneEnds: number[] = [];
    const spans = [...agg.entries()]
      .map(([activityId, v]) => ({ activityId, ...v }))
      .sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol)
      .map((s) => {
        let lane = laneEnds.findIndex((e) => e < s.startCol);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(s.endCol);
        } else {
          laneEnds[lane] = s.endCol;
        }
        return {
          ...s,
          continuesLeft: s.spanStart < weekFirst,
          continuesRight: s.spanEnd > weekLast,
          lane,
        };
      });
    return { weekCells, spans, laneCount: laneEnds.length };
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
      </div>
      {/* One relative container per week so each row can overlay its own span
          bars above the bordered day cells. */}
      <div className="flex flex-col gap-1">
        {weeks.map((week, w) => (
          <div key={w} className="relative">
            <div className="grid grid-cols-7 gap-1">
              {week.weekCells.map((c) => {
                const visible = c.nonSpan.slice(0, MONTH_BANNERS_PER_CELL);
                const hidden = c.nonSpan.slice(MONTH_BANNERS_PER_CELL);
                const overflow =
                  hidden.length > 0 ? summarizeOverflow(hidden) : null;
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
                    {week.laneCount > 0 && (
                      <div
                        aria-hidden
                        style={{ height: week.laneCount * MONTH_LANE_H }}
                      />
                    )}
                    {c.inMonth && c.nonSpan.length > 0 && (
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

            {week.spans.length > 0 && (
              <div
                className="pointer-events-none absolute inset-x-0 grid grid-cols-7 gap-1"
                style={{ top: MONTH_SPAN_TOP, gridAutoRows: `${MONTH_LANE_H}px` }}
              >
                {week.spans.map((s) => {
                  const firstTag = s.tags[0];
                  const info = firstTag ? tagMap[firstTag] : undefined;
                  const color = info
                    ? tagChipClasses(info.color)
                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
                  return (
                    <button
                      key={s.activityId}
                      type="button"
                      title={s.name}
                      onClick={() =>
                        onJumpToDay(week.weekCells[s.startCol].dateStr)
                      }
                      style={{
                        gridColumn: `${s.startCol + 1} / span ${s.endCol - s.startCol + 1}`,
                        gridRowStart: s.lane + 1,
                      }}
                      className={`pointer-events-auto mx-0.5 h-3.5 overflow-hidden truncate px-1 text-left text-[9px] font-medium leading-[14px] ${color} ${
                        s.continuesLeft ? "rounded-l-none" : "rounded-l-sm"
                      } ${s.continuesRight ? "rounded-r-none" : "rounded-r-sm"}`}
                    >
                      {s.continuesLeft ? " " : s.name}
                    </button>
                  );
                })}
              </div>
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
