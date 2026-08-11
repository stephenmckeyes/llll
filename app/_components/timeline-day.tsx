"use client";

// ---------------------------------------------------------------------------
// TimelineDay — Calendar's Timeline toggle for the Day sub-view.
//
// Renders a ±day WINDOW as vertically-stacked day sections (matches
// Day view's infinite-scroll UX per user spec: "continue to scroll
// onto previous and future days"). Each section is:
//
//   [Day header — Weekday, Mon d + Today badge]
//   [Hour rail | positioned event blocks]
//   [Untimed activities list (if any)]
//
// Sticky top strip (chips only) stays pinned as the user scrolls.
// Conflict banners for TODAY float above the day stack; users can
// still ack from either here or the /notifications page (both write
// the same conflict_acknowledgements row, migration 0036).
//
// Overlapping events use `layoutEvents` from timeline-shared to
// split horizontally into columns with alternating background
// shades so overlapping blocks stay legible.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { acknowledgeConflict } from "@/app/actions/conflicts";
import type { TagMap } from "@/lib/domain/tags";
import { formatTimeRange } from "@/lib/ui/format-time";
import { useTimeFormat } from "@/lib/ui/format-time-client";

import { ActivityModal } from "./activity-modal";
import type { DayInstance } from "./day-list";
import { IncompleteButton, type IncompleteInfo } from "./incomplete-button";
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

function dateLabelLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function TimelineDay({
  centerDate,
  todayStr,
  days,
  tagMap,
  incompleteInfo,
  acknowledgedPairKeys = [],
  chipsSlot,
}: {
  /** URL's ?date=… — used for the initial scroll target and as the
   *  identity key so remount snaps back to today when the user picks
   *  a different date. */
  centerDate: string;
  todayStr: string;
  /** Every day in the ±window, chronologically. Empty-instance days
   *  are included so the scroll rhythm stays consistent. */
  days: Array<{ date: string; instances: DayInstance[] }>;
  tagMap: TagMap;
  /** Powers the "Unlabeled (N)" chip in the sticky top row — same
   *  count DayList shows so the header info is consistent between
   *  Timeline-off and Timeline-on. */
  incompleteInfo: IncompleteInfo;
  acknowledgedPairKeys?: readonly string[];
  chipsSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const [locallyAcked, setLocallyAcked] = useState<Set<string>>(new Set());
  const [, startAckTransition] = useTransition();
  const [openInstance, setOpenInstance] = useState<DayInstance | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Currently-visible day (topmost day section inside the viewport).
  // Drives both the friendly label above the Today button AND the
  // date-input value, so the header always describes what the user
  // is looking at as they scroll. Defaults to centerDate on mount /
  // when the URL date changes. IntersectionObserver-updated below.
  const [visibleDate, setVisibleDate] = useState(centerDate);
  const [visibleSnapshot, setVisibleSnapshot] = useState(centerDate);
  if (visibleSnapshot !== centerDate) {
    setVisibleSnapshot(centerDate);
    setVisibleDate(centerDate);
  }
  function hrefFor(date: string): string {
    return `/?view=day&date=${date}&timeline=1`;
  }
  function shiftFromDate(from: string, delta: number): string {
    const [y, m, d] = from.split("-").map(Number);
    const dt = new Date(y, m - 1, d + delta);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
  }

  // Conflict detection: only surface TODAY's overlapping pairs at
  // the top. Per-day conflicts within a scrolled-past day would
  // pile up and obscure today's actual conflicts.
  const todayInstances = useMemo(
    () => days.find((d) => d.date === todayStr)?.instances ?? [],
    [days, todayStr]
  );
  const todayTimed = useMemo(
    () => buildEvents(todayInstances).timed,
    [todayInstances]
  );
  const conflicts = useMemo(() => detectConflicts(todayTimed), [todayTimed]);

  const dismissed = useMemo(() => {
    const s = new Set(acknowledgedPairKeys);
    for (const k of locallyAcked) s.add(k);
    return s;
  }, [acknowledgedPairKeys, locallyAcked]);
  const visibleConflicts = conflicts.filter(
    (c) => !dismissed.has(conflictKey(todayStr, c.a, c.b))
  );

  const acknowledge = useCallback(
    (c: Conflict<DayInstance>) => {
      const key = conflictKey(todayStr, c.a, c.b);
      setLocallyAcked((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      startAckTransition(async () => {
        await acknowledgeConflict(key);
      });
    },
    [todayStr]
  );

  // Drop stale open modal if the underlying instance disappeared
  // (React 19 snapshot pattern instead of setState-in-useEffect).
  const allInstances = useMemo(
    () => days.flatMap((d) => d.instances),
    [days]
  );
  if (
    openInstance !== null &&
    !allInstances.some((i) => i.id === openInstance.id)
  ) {
    setOpenInstance(null);
  }

  // On mount (and any centerDate change), snap the scroll so the
  // centered day's section is at the top of the visible area. iOS
  // Safari needs a small delay for layout to settle first.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const t = setTimeout(() => {
      const el = container.querySelector<HTMLElement>(
        `[data-timeline-day="${centerDate}"]`
      );
      if (!el) return;
      const parent = container.parentElement;
      if (!parent) return;
      const parentRect = parent.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      parent.scrollTop += elRect.top - parentRect.top;
    }, 30);
    return () => clearTimeout(t);
  }, [centerDate]);

  // Track the TOPMOST visible day section and expose its date via
  // `visibleDate`. Same pattern DayList uses for its friendly label.
  // Observing against the outer scroll container (parentElement) so
  // rootMargin's top edge lines up with the visible area, discounting
  // the sticky header height. rootMargin's bottom is aggressive so
  // only sections near the top of the viewport count as "visible."
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scroller = container.parentElement;
    if (!scroller) return;
    const sections = Array.from(
      container.querySelectorAll<HTMLElement>("[data-timeline-day]")
    );
    if (sections.length === 0) return;

    // Track intersection ratios; pick the section closest to the
    // top with a non-zero intersection.
    const visibility = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const date = entry.target.getAttribute("data-timeline-day");
          if (!date) continue;
          if (entry.isIntersecting) {
            visibility.set(date, entry.intersectionRatio || 0.0001);
          } else {
            visibility.delete(date);
          }
        }
        // The section whose top is nearest the scroller's top wins —
        // that's the "currently reading" day.
        let best: { date: string; top: number } | null = null;
        for (const date of visibility.keys()) {
          const el = container.querySelector<HTMLElement>(
            `[data-timeline-day="${date}"]`
          );
          if (!el) continue;
          const top =
            el.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top;
          if (best === null || Math.abs(top) < Math.abs(best.top)) {
            best = { date, top };
          }
        }
        if (best) setVisibleDate(best.date);
      },
      {
        root: scroller,
        // Trim ~80px from the top to account for the sticky header;
        // the "top" from the observer's POV is just below the strip.
        rootMargin: "-80px 0px -50% 0px",
        threshold: [0, 0.1, 0.5, 1],
      }
    );
    for (const s of sections) observer.observe(s);
    return () => observer.disconnect();
  }, [days]);

  return (
    <div ref={containerRef} className="flex flex-col gap-3">
      {/* Sticky top strip — mirrors the DayList header exactly:
          friendly label above, [← input → Today Unlabeled … chips]
          below. The label + input show `visibleDate` (updated by the
          IntersectionObserver above), so they describe whatever day
          the user is currently scrolled to. */}
      <div className="sticky top-0 z-10 -mx-6 flex flex-col gap-1 bg-white px-6 py-2 dark:bg-zinc-950">
        <p className="text-center text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {dateLabelLong(visibleDate)}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={hrefFor(shiftFromDate(visibleDate, -1))}
            aria-label="Previous day"
            className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            ←
          </Link>
          <input
            type="date"
            value={visibleDate}
            onChange={(e) => {
              const v = e.target.value;
              if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                setVisibleDate(v);
                router.push(hrefFor(v));
              }
            }}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <Link
            href={hrefFor(shiftFromDate(visibleDate, 1))}
            aria-label="Next day"
            className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            →
          </Link>
          <Link
            href={hrefFor(todayStr)}
            className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Today
          </Link>
          <IncompleteButton info={incompleteInfo} />
          {chipsSlot && <div className="ml-auto shrink-0">{chipsSlot}</div>}
        </div>
      </div>

      {visibleConflicts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {visibleConflicts.map((c) => (
            <li
              key={conflictKey(todayStr, c.a, c.b)}
              className="rounded-md border-2 border-amber-400 bg-amber-50 p-3 text-sm dark:border-amber-600 dark:bg-amber-950"
            >
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                Scheduling conflict today
              </p>
              <p className="mt-1 text-amber-900/90 dark:text-amber-100">
                <button
                  type="button"
                  onClick={() => setOpenInstance(c.a.data)}
                  className="underline underline-offset-2"
                >
                  {activityName(c.a.data)}
                </button>{" "}
                overlaps{" "}
                <button
                  type="button"
                  onClick={() => setOpenInstance(c.b.data)}
                  className="underline underline-offset-2"
                >
                  {activityName(c.b.data)}
                </button>
                .
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

      {days.map((d) => (
        <TimelineDaySection
          key={d.date}
          date={d.date}
          todayStr={todayStr}
          instances={d.instances}
          onOpen={setOpenInstance}
        />
      ))}

      {openInstance && (
        <ActivityModal
          instance={openInstance}
          todayStr={todayStr}
          onClose={() => setOpenInstance(null)}
          tagMap={tagMap}
        />
      )}
      {/* tagMap silences the unused-var lint when no modal is open. */}
      {false && <span>{Object.keys(tagMap).length}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single-day section: header + hour grid + untimed activities.
// Extracted so we can render N of them stacked cheaply.
// ---------------------------------------------------------------------------

function TimelineDaySection({
  date,
  todayStr,
  instances,
  onOpen,
}: {
  date: string;
  todayStr: string;
  instances: DayInstance[];
  onOpen: (inst: DayInstance) => void;
}) {
  const timeFormat = useTimeFormat();
  const { timed, untimed } = useMemo(() => buildEvents(instances), [instances]);
  const layout = useMemo(() => layoutEvents(timed), [timed]);
  const isToday = date === todayStr;
  const label = dateLabelLong(date);

  return (
    <section
      data-timeline-day={date}
      className="flex flex-col gap-2 scroll-mt-14"
    >
      <h3
        className={`flex items-baseline gap-2 text-sm font-medium uppercase tracking-wide ${
          isToday
            ? "text-zinc-900 dark:text-zinc-50"
            : "text-zinc-500 dark:text-zinc-400"
        }`}
      >
        <span>{label}</span>
        {isToday && (
          <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-white dark:bg-zinc-50 dark:text-zinc-900">
            Today
          </span>
        )}
      </h3>

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
            if (endMin <= HOURS_START * 60) return null;
            if (startMin >= HOURS_END * 60) return null;
            const gridTop = ((startMin - HOURS_START * 60) / 60) * HOUR_PX;
            const gridHeight = Math.max(
              18,
              ((endMin - startMin) / 60) * HOUR_PX
            );
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
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Untimed ({untimed.length} activit
            {untimed.length === 1 ? "y" : "ies"})
          </p>
          <ul className="flex flex-col gap-1">
            {untimed.map((inst) => {
              const isDone = inst.status === "completed";
              const isMissed = inst.status === "missed";
              return (
                <li key={inst.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(inst)}
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
        </div>
      )}

      {timed.length === 0 && untimed.length === 0 && (
        <p className="text-xs italic text-zinc-400 dark:text-zinc-600">
          Nothing scheduled.
        </p>
      )}
    </section>
  );
}
