"use client";

// ---------------------------------------------------------------------------
// TimelineDay — the client body of the Calendar's Timeline toggle when
// the day sub-view is active.
//
// Renders a single day as a vertical hour column with each scheduled
// activity positioned by its start-time (and sized by its end-time when
// provided). Overlapping blocks split the horizontal space via the
// shared `layoutEvents` algorithm — clear delineation per user spec.
//
// Interaction — clicking a block opens the SAME ActivityModal the Day
// list uses so mark complete / missed / unlabel / edit all work from
// Timeline exactly like Day. Conflict banners at the top call out
// overlapping timed blocks and can be dismissed with "Got it"
// (localStorage-scoped to date + pair).
//
// Untimed activities render below the grid as an "Untimed (N)" summary
// per user spec ("at the bottom show '# activities' for the non-
// timeline to-dos").
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from "react";

import type { TagMap } from "@/lib/domain/tags";
import { formatTimeRange } from "@/lib/ui/format-time";
import { useTimeFormat } from "@/lib/ui/format-time-client";

import { ActivityModal } from "./activity-modal";
import type { DayInstance } from "./day-list";
import {
  conflictKey,
  detectConflicts,
  effectiveEndMinutes,
  HOUR_PX,
  HOURS_END,
  HOURS_START,
  layoutEvents,
  minutesFromHhmm,
  type Conflict,
  type TimelineEvent,
} from "./timeline-shared";

const LS_KEY = "mission-conflicts-dismissed";

function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissed(s: Set<string>) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(Array.from(s)));
  } catch {
    // best-effort
  }
}

type DayEvent = TimelineEvent<DayInstance>;

function buildEvents(instances: DayInstance[]): {
  timed: DayEvent[];
  untimed: DayInstance[];
} {
  const timed: DayEvent[] = [];
  const untimed: DayInstance[] = [];
  for (const inst of instances) {
    const starts = inst.activity.scheduled_times ?? [];
    const ends = inst.activity.scheduled_end_times ?? [];
    if (starts.length === 0) {
      untimed.push(inst);
      continue;
    }
    for (let i = 0; i < starts.length; i++) {
      timed.push({
        key: `${inst.id}:${i}`,
        data: inst,
        start: starts[i],
        end: ends[i] ?? "",
      });
    }
  }
  return { timed, untimed };
}

function activityName(inst: DayInstance): string {
  return inst.overrideName ?? inst.activity.name;
}

export function TimelineDay({
  date,
  todayStr,
  instances,
  tagMap,
}: {
  date: string;
  todayStr: string;
  instances: DayInstance[];
  tagMap: TagMap;
}) {
  const timeFormat = useTimeFormat();
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    loadDismissed()
  );
  const [openInstance, setOpenInstance] = useState<DayInstance | null>(null);

  const { timed, untimed } = useMemo(() => buildEvents(instances), [instances]);
  const layout = useMemo(() => layoutEvents(timed), [timed]);
  const conflicts = useMemo(() => detectConflicts(timed), [timed]);
  const visibleConflicts = conflicts.filter(
    (c) => !dismissed.has(conflictKey(date, c.a, c.b))
  );

  const acknowledge = useCallback(
    (c: Conflict<DayInstance>) => {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.add(conflictKey(date, c.a, c.b));
        saveDismissed(next);
        return next;
      });
    },
    [date]
  );

  // Snapshot pattern (React 19): if the instances list no longer
  // contains the currently-open modal's activity, drop the reference.
  if (
    openInstance !== null &&
    !instances.some((i) => i.id === openInstance.id)
  ) {
    setOpenInstance(null);
  }

  const dateLabel = useMemo(() => {
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }, [date]);

  const conflictedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) {
      s.add(c.a.key);
      s.add(c.b.key);
    }
    return s;
  }, [conflicts]);

  return (
    <div className="flex flex-col gap-3">
      <p
        className={`text-sm font-medium ${
          date === todayStr
            ? "text-zinc-900 dark:text-zinc-50"
            : "text-zinc-600 dark:text-zinc-400"
        }`}
      >
        {dateLabel}
        {date === todayStr && (
          <span className="ml-2 rounded-full bg-zinc-900 px-1.5 py-0.5 text-[10px] font-medium text-white dark:bg-zinc-50 dark:text-zinc-900">
            Today
          </span>
        )}
      </p>

      {visibleConflicts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {visibleConflicts.map((c) => (
            <li
              key={conflictKey(date, c.a, c.b)}
              className="rounded-md border-2 border-amber-400 bg-amber-50 p-3 text-sm dark:border-amber-600 dark:bg-amber-950"
            >
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                Scheduling conflict
              </p>
              <p className="mt-1 text-amber-900/90 dark:text-amber-100">
                <button
                  type="button"
                  onClick={() => setOpenInstance(c.a.data)}
                  className="underline underline-offset-2"
                >
                  {activityName(c.a.data)}
                </button>{" "}
                ({formatTimeRange(c.a.start, c.a.end, timeFormat)}) overlaps
                with{" "}
                <button
                  type="button"
                  onClick={() => setOpenInstance(c.b.data)}
                  className="underline underline-offset-2"
                >
                  {activityName(c.b.data)}
                </button>{" "}
                ({formatTimeRange(c.b.start, c.b.end, timeFormat)}).
              </p>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => acknowledge(c)}
                  className="rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  Got it
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="relative flex gap-2">
        <div className="w-12 shrink-0">
          {Array.from({ length: HOURS_END - HOURS_START }, (_, i) => {
            const hour = HOURS_START + i;
            const hhmm = `${String(hour).padStart(2, "0")}:00`;
            return (
              <div
                key={hour}
                style={{ height: HOUR_PX }}
                className="flex items-start justify-end pr-1 text-[10px] tabular-nums text-zinc-500"
              >
                {formatTimeRange(hhmm, "", timeFormat)}
              </div>
            );
          })}
        </div>

        <div
          className="relative flex-1 rounded-md border border-zinc-200 dark:border-zinc-800"
          style={{ height: (HOURS_END - HOURS_START) * HOUR_PX }}
        >
          {Array.from({ length: HOURS_END - HOURS_START }, (_, i) => (
            <div
              key={i}
              style={{ top: i * HOUR_PX, height: HOUR_PX }}
              className="absolute inset-x-0 border-t border-dashed border-zinc-200 first:border-t-0 dark:border-zinc-800"
            />
          ))}
          {timed.map((ev) => {
            const startMin = minutesFromHhmm(ev.start);
            const endMin = effectiveEndMinutes(ev);
            const gridTop = ((startMin - HOURS_START * 60) / 60) * HOUR_PX;
            const gridHeight = Math.max(
              18,
              ((endMin - startMin) / 60) * HOUR_PX
            );
            if (endMin <= HOURS_START * 60) return null;
            if (startMin >= HOURS_END * 60) return null;

            const slot = layout.get(ev.key) ?? { col: 0, cols: 1 };
            const widthPct = 100 / slot.cols;
            const leftPct = slot.col * widthPct;

            const inst = ev.data;
            const isDone = inst.status === "completed";
            const isMissed = inst.status === "missed";
            const isConflicted = conflictedKeys.has(ev.key);
            const borderClass = isConflicted
              ? "border-amber-500"
              : isDone
                ? "border-emerald-500"
                : isMissed
                  ? "border-red-500"
                  : "border-zinc-400 dark:border-zinc-600";
            // Alternate a subtle background shade per column so
            // side-by-side overlapping blocks read as clearly
            // separate cards even though they share a rect.
            const bgClass =
              slot.col % 2 === 0
                ? "bg-zinc-100 dark:bg-zinc-800"
                : "bg-white dark:bg-zinc-900";
            return (
              <button
                key={ev.key}
                type="button"
                onClick={() => setOpenInstance(inst)}
                title={`${activityName(inst)} · ${formatTimeRange(ev.start, ev.end, timeFormat)}`}
                style={{
                  top: Math.max(0, gridTop),
                  height: gridHeight,
                  // 2px inset from each side keeps a visible gutter
                  // between neighboring overlap columns.
                  left: `calc(${leftPct}% + 2px)`,
                  width: `calc(${widthPct}% - 4px)`,
                }}
                className={`absolute overflow-hidden rounded border-l-4 px-2 py-1 text-left text-[11px] font-medium text-zinc-900 shadow-sm ring-1 ring-black/5 transition-colors hover:brightness-95 dark:text-zinc-100 dark:ring-white/10 ${bgClass} ${borderClass} ${
                  isDone ? "opacity-70 line-through" : ""
                }`}
              >
                <div className="truncate">{activityName(inst)}</div>
                <div className="truncate text-[10px] text-zinc-700 dark:text-zinc-300">
                  {formatTimeRange(ev.start, ev.end, timeFormat)}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {untimed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Untimed ({untimed.length} activit
            {untimed.length === 1 ? "y" : "ies"})
          </h3>
          <ul className="flex flex-col gap-1">
            {untimed.map((inst) => {
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
                    <span className="truncate">{activityName(inst)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {timed.length === 0 && untimed.length === 0 && (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nothing scheduled for this day.
        </p>
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
