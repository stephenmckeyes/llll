"use client";

// ---------------------------------------------------------------------------
// TimelineWeek — 7 side-by-side day columns, each a mini vertical
// hour grid. Same interaction as TimelineDay (click a block → open
// the ActivityModal). Per user spec: "When timeline is turned on,
// show the timelines on the week view as well as possible and then
// at the bottom show '# activities' for the non-timeline to-dos."
//
// Overlap handling is per-day: each column runs the same
// `layoutEvents` splitter TimelineDay uses. Day columns are narrow
// on phones so heavy overlaps still get crowded, but the algorithm
// keeps overlap groups readable side by side with alternating
// background shades.
//
// Untimed activities render below the grid grouped by day, with a
// leading "N untimed activities this week" summary.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";

import type { TagMap } from "@/lib/domain/tags";
import { formatTime, formatTimeRange } from "@/lib/ui/format-time";
import { useTimeFormat } from "@/lib/ui/format-time-client";

import { ActivityModal } from "./activity-modal";
import type { DayInstance } from "./day-list";
import {
  effectiveEndMinutes,
  HOUR_PX,
  HOURS_END,
  HOURS_START,
  layoutEvents,
  minutesFromHhmm,
  type TimelineEvent,
} from "./timeline-shared";

type WeekEvent = TimelineEvent<DayInstance>;

function activityName(inst: DayInstance): string {
  return inst.overrideName ?? inst.activity.name;
}

function buildPerDay(instances: DayInstance[]): {
  timedByDate: Map<string, WeekEvent[]>;
  untimedByDate: Map<string, DayInstance[]>;
} {
  const timedByDate = new Map<string, WeekEvent[]>();
  const untimedByDate = new Map<string, DayInstance[]>();
  for (const inst of instances) {
    const starts = inst.activity.scheduled_times ?? [];
    const ends = inst.activity.scheduled_end_times ?? [];
    const date = inst.scheduled_for;
    if (starts.length === 0) {
      const arr = untimedByDate.get(date) ?? [];
      arr.push(inst);
      untimedByDate.set(date, arr);
      continue;
    }
    const arr = timedByDate.get(date) ?? [];
    for (let i = 0; i < starts.length; i++) {
      arr.push({
        key: `${inst.id}:${i}`,
        data: inst,
        start: starts[i],
        end: ends[i] ?? "",
      });
    }
    timedByDate.set(date, arr);
  }
  return { timedByDate, untimedByDate };
}

export function TimelineWeek({
  weekDates,
  todayStr,
  instances,
  tagMap,
  chipsSlot,
}: {
  /** 7 YYYY-MM-DD strings, Monday..Sunday. */
  weekDates: string[];
  todayStr: string;
  instances: DayInstance[];
  tagMap: TagMap;
  /** Timeline / Filters chips rendered at the top of the week grid
   *  so they sit on the same visual line as the top control. */
  chipsSlot?: React.ReactNode;
}) {
  const timeFormat = useTimeFormat();
  const [openInstance, setOpenInstance] = useState<DayInstance | null>(null);

  const { timedByDate, untimedByDate } = useMemo(
    () => buildPerDay(instances),
    [instances]
  );

  const untimedTotal = useMemo(() => {
    let n = 0;
    for (const arr of untimedByDate.values()) n += arr.length;
    return n;
  }, [untimedByDate]);

  // Drop stale open modal if the underlying instance disappeared.
  if (
    openInstance !== null &&
    !instances.some((i) => i.id === openInstance.id)
  ) {
    setOpenInstance(null);
  }

  return (
    <div className="flex flex-col gap-3">
      {chipsSlot && (
        <div className="flex items-start justify-end">{chipsSlot}</div>
      )}
      {/* Grid: hour rail on the left, then 7 narrow day columns. */}
      <div className="flex gap-1">
        <div className="w-10 shrink-0 pt-6">
          {Array.from({ length: HOURS_END - HOURS_START }, (_, i) => {
            const hour = HOURS_START + i;
            const hhmm = `${String(hour).padStart(2, "0")}:00`;
            return (
              <div
                key={hour}
                style={{ height: HOUR_PX }}
                className="flex items-start justify-end pr-1 text-[9px] tabular-nums text-zinc-500"
              >
                {formatTime(hhmm, timeFormat)}
              </div>
            );
          })}
        </div>

        <div className="flex flex-1 min-w-0 gap-0.5">
          {weekDates.map((date) => (
            <DayColumn
              key={date}
              date={date}
              todayStr={todayStr}
              events={timedByDate.get(date) ?? []}
              timeFormat={timeFormat}
              onOpen={setOpenInstance}
            />
          ))}
        </div>
      </div>

      {/* Untimed summary per user spec. Groups by day with a top-line
          total across the whole week. */}
      {untimedTotal > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Untimed ({untimedTotal} activit
            {untimedTotal === 1 ? "y" : "ies"} this week)
          </h3>
          <ul className="flex flex-col gap-2">
            {weekDates.map((date) => {
              const items = untimedByDate.get(date) ?? [];
              if (items.length === 0) return null;
              return (
                <li key={date} className="flex flex-col gap-1">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                    {formatWeekdayShort(date)} · {items.length}
                  </p>
                  <ul className="flex flex-col gap-1">
                    {items.map((inst) => {
                      const isDone = inst.status === "completed";
                      const isMissed = inst.status === "missed";
                      return (
                        <li key={inst.id}>
                          <button
                            type="button"
                            onClick={() => setOpenInstance(inst)}
                            className={`flex w-full items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 ${
                              isDone ? "opacity-60 line-through" : ""
                            }`}
                          >
                            <span
                              aria-hidden
                              className={`h-2 w-2 shrink-0 rounded-full ${
                                isDone
                                  ? "bg-emerald-500"
                                  : isMissed
                                    ? "bg-red-500"
                                    : "bg-zinc-400"
                              }`}
                            />
                            <span className="truncate">
                              {activityName(inst)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {openInstance && (
        <ActivityModal
          instance={openInstance}
          todayStr={todayStr}
          onClose={() => setOpenInstance(null)}
          tagMap={tagMap}
        />
      )}
    </div>
  );
}

function formatWeekdayShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function DayColumn({
  date,
  todayStr,
  events,
  timeFormat,
  onOpen,
}: {
  date: string;
  todayStr: string;
  events: WeekEvent[];
  timeFormat: import("@/lib/ui/format-time").TimeFormat;
  onOpen: (inst: DayInstance) => void;
}) {
  const layout = useMemo(() => layoutEvents(events), [events]);
  const isToday = date === todayStr;
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dayLabel = dt.toLocaleDateString(undefined, {
    weekday: "short",
  });
  const dateNum = dt.getDate();

  return (
    <div className="flex flex-1 min-w-0 flex-col gap-1">
      <div
        className={`text-center text-[10px] font-medium uppercase tracking-wide ${
          isToday
            ? "text-zinc-900 dark:text-zinc-50"
            : "text-zinc-500 dark:text-zinc-400"
        }`}
      >
        <div>{dayLabel}</div>
        <div
          className={`mx-auto inline-flex h-5 w-5 items-center justify-center text-[11px] tabular-nums ${
            isToday
              ? "rounded-full bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
              : ""
          }`}
        >
          {dateNum}
        </div>
      </div>
      <div
        className={`relative rounded-md border ${
          isToday
            ? "border-zinc-900 dark:border-zinc-50"
            : "border-zinc-200 dark:border-zinc-800"
        }`}
        style={{ height: (HOURS_END - HOURS_START) * HOUR_PX }}
      >
        {Array.from({ length: HOURS_END - HOURS_START }, (_, i) => (
          <div
            key={i}
            style={{ top: i * HOUR_PX, height: HOUR_PX }}
            className="absolute inset-x-0 border-t border-dashed border-zinc-200 first:border-t-0 dark:border-zinc-800"
          />
        ))}
        {events.map((ev) => {
          const startMin = minutesFromHhmm(ev.start);
          const endMin = effectiveEndMinutes(ev);
          if (endMin <= HOURS_START * 60) return null;
          if (startMin >= HOURS_END * 60) return null;
          const gridTop = ((startMin - HOURS_START * 60) / 60) * HOUR_PX;
          const gridHeight = Math.max(14, ((endMin - startMin) / 60) * HOUR_PX);
          const slot = layout.get(ev.key) ?? { col: 0, cols: 1 };
          const widthPct = 100 / slot.cols;
          const leftPct = slot.col * widthPct;

          const inst = ev.data;
          const isDone = inst.status === "completed";
          const isMissed = inst.status === "missed";
          const borderClass = isDone
            ? "border-emerald-500"
            : isMissed
              ? "border-red-500"
              : "border-zinc-400 dark:border-zinc-600";
          const bgClass =
            slot.col % 2 === 0
              ? "bg-zinc-100 dark:bg-zinc-800"
              : "bg-white dark:bg-zinc-900";
          return (
            <button
              key={ev.key}
              type="button"
              onClick={() => onOpen(inst)}
              title={`${activityName(inst)} · ${formatTimeRange(ev.start, ev.end, timeFormat)}`}
              style={{
                top: Math.max(0, gridTop),
                height: gridHeight,
                left: `calc(${leftPct}% + 1px)`,
                width: `calc(${widthPct}% - 2px)`,
              }}
              className={`absolute overflow-hidden rounded border-l-2 px-1 py-0.5 text-left text-[9px] font-medium text-zinc-900 shadow-sm ring-1 ring-black/5 transition-colors hover:brightness-95 dark:text-zinc-100 dark:ring-white/10 ${bgClass} ${borderClass} ${
                isDone ? "opacity-70 line-through" : ""
              }`}
            >
              <div className="truncate leading-tight">{activityName(inst)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
