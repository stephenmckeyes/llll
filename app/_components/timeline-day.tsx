"use client";

// ---------------------------------------------------------------------------
// TimelineDay — the client body of the Calendar's Timeline sub-view.
//
// Renders a single day as a vertical hour column with each scheduled
// activity positioned by its start-time (and sized by its end-time when
// provided). Purpose per user spec: "you would be able to visually see
// that you do not have anything scheduled from 1300-1400 on a certain
// day, or that you have multiple things scheduled at the same time."
//
// Conflict handling — when two timed blocks overlap on this day, a
// notification chip surfaces at the top with a link to both activities.
// Once the user clicks "Got it" the notification is dismissed via
// localStorage keyed by the specific pair + date; it doesn't reappear on
// this day even if the conflict isn't fixed. Fixing the conflict (by
// editing one activity) drops it from the detected set naturally.
//
// Untimed activities (no scheduled start) render below the grid in an
// "Untimed" bucket — per user spec ("do not assign it a time of day and
// just prioritize showing it after the events that have a specific
// time").
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatTimeRange } from "@/lib/ui/format-time";
import { useTimeFormat } from "@/lib/ui/format-time-client";

// One rendered event — the same activity can produce multiple entries
// when it has multiple scheduled_times (e.g. a Multi-Daily rhythm).
export type TimelineEvent = {
  /** Stable per-event id: `${instanceId}:${timeIndex}`. */
  key: string;
  activityId: string;
  activityName: string;
  /** "HH:MM" start. */
  start: string;
  /** "HH:MM" end, or "" when no end was set (renders 30-min default). */
  end: string;
  /** Optional tag color for the block bg. */
  color: string | null;
};

export type UntimedEvent = {
  key: string;
  activityId: string;
  activityName: string;
  color: string | null;
};

// A single conflict = pair of events whose [start, end) overlap.
type Conflict = { a: TimelineEvent; b: TimelineEvent };

const HOURS_START = 6; // Render 6 AM …
const HOURS_END = 24; // … through midnight (exclusive). Untimed goes below.
const HOUR_PX = 44;

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

function conflictKey(date: string, a: TimelineEvent, b: TimelineEvent): string {
  // Deterministic ordering so (A,B) and (B,A) share a key.
  const [x, y] = a.key < b.key ? [a, b] : [b, a];
  return `${date}|${x.key}|${y.key}`;
}

function minutesFromHhmm(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

// End default when the activity has no explicit end: 30 minutes past
// start, capped at HOURS_END. Purely visual — the DB stays "".
function effectiveEndMinutes(ev: TimelineEvent): number {
  if (ev.end) return minutesFromHhmm(ev.end);
  return Math.min(minutesFromHhmm(ev.start) + 30, HOURS_END * 60);
}

function detectConflicts(events: TimelineEvent[]): Conflict[] {
  // Sort by start, sweep for overlaps. O(n²) worst case is fine here —
  // a single day rarely has more than a handful of timed events.
  const sorted = [...events].sort(
    (a, b) => minutesFromHhmm(a.start) - minutesFromHhmm(b.start)
  );
  const conflicts: Conflict[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const aEnd = effectiveEndMinutes(a);
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const bStart = minutesFromHhmm(b.start);
      if (bStart >= aEnd) break;
      conflicts.push({ a, b });
    }
  }
  return conflicts;
}

export function TimelineDay({
  date,
  todayStr,
  timed,
  untimed,
}: {
  date: string;
  todayStr: string;
  timed: TimelineEvent[];
  untimed: UntimedEvent[];
}) {
  const timeFormat = useTimeFormat();
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed());

  const conflicts = useMemo(() => detectConflicts(timed), [timed]);
  const visibleConflicts = conflicts.filter(
    (c) => !dismissed.has(conflictKey(date, c.a, c.b))
  );

  const acknowledge = useCallback(
    (c: Conflict) => {
      setDismissed((prev) => {
        const next = new Set(prev);
        next.add(conflictKey(date, c.a, c.b));
        saveDismissed(next);
        return next;
      });
    },
    [date]
  );

  // The date navigator lives on the page.tsx side (StickyNav), so this
  // component just shows a title strip so the user knows which day
  // they're inspecting when scrolling the tall column.
  const dateLabel = useMemo(() => {
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }, [date]);

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
                <Link
                  href={`/?view=day&date=${date}`}
                  className="underline underline-offset-2"
                >
                  {c.a.activityName}
                </Link>{" "}
                (
                {formatTimeRange(c.a.start, c.a.end, timeFormat)}) overlaps with{" "}
                <Link
                  href={`/?view=day&date=${date}`}
                  className="underline underline-offset-2"
                >
                  {c.b.activityName}
                </Link>{" "}
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
        {/* Hour rail — one row per hour with a right-side gridline. */}
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

        {/* Event column with dashed gridlines every hour. */}
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
            // Clip events that fall outside [HOURS_START, HOURS_END).
            if (endMin <= HOURS_START * 60) return null;
            if (startMin >= HOURS_END * 60) return null;
            const isConflicted = conflicts.some(
              (c) => c.a.key === ev.key || c.b.key === ev.key
            );
            const borderClass = isConflicted
              ? "border-amber-500"
              : "border-zinc-400 dark:border-zinc-600";
            return (
              <Link
                key={ev.key}
                href={`/?view=day&date=${date}`}
                title={`${ev.activityName} · ${formatTimeRange(ev.start, ev.end, timeFormat)}`}
                style={{
                  top: Math.max(0, gridTop),
                  height: gridHeight,
                  backgroundColor: ev.color ?? undefined,
                }}
                className={`absolute inset-x-1 overflow-hidden rounded border-l-4 bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-900 shadow-sm transition-colors hover:brightness-95 dark:bg-zinc-800 dark:text-zinc-100 ${borderClass}`}
              >
                <div className="truncate">{ev.activityName}</div>
                <div className="truncate text-[10px] text-zinc-700 dark:text-zinc-300">
                  {formatTimeRange(ev.start, ev.end, timeFormat)}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {untimed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Untimed ({untimed.length})
          </h3>
          <ul className="flex flex-col gap-1">
            {untimed.map((it) => (
              <li key={it.key}>
                <Link
                  href={`/?view=day&date=${date}`}
                  className="flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                >
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor: it.color ?? "rgb(161 161 170)",
                    }}
                  />
                  <span className="truncate">{it.activityName}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {timed.length === 0 && untimed.length === 0 && (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nothing scheduled for this day.
        </p>
      )}
    </div>
  );
}
