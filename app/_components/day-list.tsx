"use client";

// ---------------------------------------------------------------------------
// Day-view scrollable list — iPhone-Calendar-list style.
//
//   - All instances are pre-fetched server-side over a wide window
//     (-90 .. +180 days from the URL's ?date= param).
//   - This client component renders every day section (even empty ones)
//     inside an internal scroll container.
//   - As the user scrolls, an IntersectionObserver tracks the topmost
//     visible date and updates the header. The date input + arrows do
//     not navigate the URL — they scroll within the list. The "Today"
//     button scrolls back to today inside the window.
//   - Clicking a row opens the activity modal in place; it does NOT
//     navigate away. Hit Escape, click outside, or press × to close.
// ---------------------------------------------------------------------------

import { addDays, format } from "date-fns";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Rhythm } from "@/lib/validators/rhythm";

import { ActivityModal } from "./activity-modal";
import { InstanceRow } from "./instance-row";

const DAY_VIEW_BACK = 90;
const DAY_VIEW_AHEAD = 180;
const TOTAL_DAYS = DAY_VIEW_BACK + 1 + DAY_VIEW_AHEAD;

export type DayInstance = {
  id: string;
  scheduled_for: string;
  completionCount: number;
  activity: {
    id: string;
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    priority: number;
    scheduled_times: string[];
    default_skill_tags: string[];
    start_date: string;
    end_date: string | null;
    archived_at: string | null;
    reminders: Array<{ amount: number; unit: string }>;
  };
};

export function DayList({
  initialDate,
  instances,
  todayStr,
}: {
  initialDate: string;
  instances: DayInstance[];
  todayStr: string;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [dateInputValue, setDateInputValue] = useState(initialDate);
  const [openInstance, setOpenInstance] = useState<DayInstance | null>(null);

  // Group instances by date for fast lookup.
  const live = useMemo(
    () => instances.filter((i) => !i.activity.archived_at),
    [instances]
  );

  // Build the day sections in chronological order.
  const days = useMemo(() => {
    const initialD = parseLocalDate(initialDate);
    const start = addDays(initialD, -DAY_VIEW_BACK);
    return Array.from({ length: TOTAL_DAYS }, (_, i) => {
      const date = addDays(start, i);
      const dateStr = format(date, "yyyy-MM-dd");
      const visible = live
        .filter((inst) => visibleOnDay(inst, dateStr, todayStr))
        .sort(compareForDay);
      return { date, dateStr, visible };
    });
  }, [initialDate, live, todayStr]);

  const windowStart = days[0]?.dateStr ?? initialDate;
  const windowEnd = days[days.length - 1]?.dateStr ?? initialDate;

  // On mount and on every initialDate change, snap the scroll to that
  // section. The setTimeout is critical on iOS Safari — without it, the
  // call fires before layout is fully painted and silently does nothing,
  // which made "the calendar isn't defaulted to today" feel broken.
  useEffect(() => {
    const t = setTimeout(() => {
      scrollContainerTo(containerRef.current, initialDate);
    }, 30);
    return () => clearTimeout(t);
  }, [initialDate]);

  // Sync the date input with the URL's initial date if it changes
  // externally (e.g., the user used the View Switcher to navigate
  // and came back).
  useEffect(() => {
    setCurrentDate(initialDate);
    setDateInputValue(initialDate);
  }, [initialDate]);

  // Track the topmost visible day section while scrolling.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let frame: number | null = null;
    const update = () => {
      const containerRect = container.getBoundingClientRect();
      const sections = container.querySelectorAll<HTMLElement>("[data-date]");
      let bestDate: string | null = null;
      let bestTop = Number.POSITIVE_INFINITY;
      for (const sec of sections) {
        const top = sec.getBoundingClientRect().top - containerRect.top;
        if (top >= -10 && top < bestTop) {
          bestTop = top;
          bestDate = sec.getAttribute("data-date");
        }
      }
      if (bestDate) {
        setCurrentDate((prev) => (prev === bestDate ? prev : bestDate!));
        setDateInputValue((prev) => (prev === bestDate ? prev : bestDate!));
      }
    };

    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        update();
        frame = null;
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  const jumpTo = useCallback(
    (dateStr: string) => {
      if (dateStr < windowStart || dateStr > windowEnd) {
        // Out of pre-rendered window — full navigation reload.
        router.push(`/?view=day&date=${dateStr}`);
        return;
      }
      // Use container.scrollTo on the actual scroll element. iOS Safari
      // handles native scrollTo reliably; scrollIntoView({behavior:"smooth"})
      // does not always animate / scroll inside an internal container.
      scrollContainerTo(containerRef.current, dateStr, "smooth");
    },
    [router, windowStart, windowEnd]
  );

  function shiftDays(delta: number) {
    jumpTo(addDaysToYmd(currentDate, delta));
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Date navigator — pinned above the scroll container, never
          scrolls. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => shiftDays(-1)}
          aria-label="Previous day"
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          ←
        </button>
        <span className="min-w-0 flex-1 text-center text-sm font-medium text-zinc-700 dark:text-zinc-300 sm:flex-none sm:px-2">
          {labelLong(currentDate)}
        </span>
        <button
          type="button"
          onClick={() => shiftDays(1)}
          aria-label="Next day"
          className="rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          →
        </button>
        <input
          type="date"
          value={dateInputValue}
          onChange={(e) => {
            setDateInputValue(e.target.value);
            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
              jumpTo(e.target.value);
            }
          }}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="button"
          onClick={() => jumpTo(todayStr)}
          className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          Today
        </button>
      </div>

      {/* Scrollable list.
          `h-[60vh]` (with vh, not svh) is intentional: iOS Safari before
          15.4 doesn't support svh; without an explicit height the container
          grows to its content and the whole page scrolls instead of the
          list — which is what was making rows un-tappable on mobile. */}
      <div
        ref={containerRef}
        className="h-[60vh] min-h-[20rem] overflow-y-auto overscroll-contain pr-2 sm:h-[68vh]"
      >
        <div className="flex flex-col gap-4">
          {days.map((d) => (
            <DaySection
              key={d.dateStr}
              date={d.date}
              dateStr={d.dateStr}
              visible={d.visible}
              todayStr={todayStr}
              onOpenInstance={setOpenInstance}
            />
          ))}
        </div>
      </div>

      {openInstance && (
        <ActivityModal
          instance={openInstance}
          todayStr={todayStr}
          onClose={() => setOpenInstance(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function DaySection({
  date,
  dateStr,
  visible,
  todayStr,
  onOpenInstance,
}: {
  date: Date;
  dateStr: string;
  visible: DayInstance[];
  todayStr: string;
  onOpenInstance: (inst: DayInstance) => void;
}) {
  const isToday = dateStr === todayStr;
  return (
    <section
      id={`day-${dateStr}`}
      data-date={dateStr}
      className="flex flex-col gap-2 scroll-mt-2"
    >
      <h2 className="flex items-baseline gap-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
        <span>{formatDateMedium(date)}</span>
        {isToday && (
          <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white dark:bg-zinc-50 dark:text-zinc-900">
            Today
          </span>
        )}
      </h2>
      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-200 px-3 py-2 text-center text-xs text-zinc-400 dark:border-zinc-800">
          Free.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((inst) => (
            <InstanceRow
              key={inst.id}
              instance={inst}
              todayStr={todayStr}
              onOpen={() => onOpenInstance(inst)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Date / rhythm helpers (kept local so the file is self-contained).
// ---------------------------------------------------------------------------

function scrollContainerTo(
  container: HTMLDivElement | null,
  dateStr: string,
  behavior: ScrollBehavior = "auto"
) {
  if (!container) return;
  const target = container.querySelector<HTMLElement>(
    `#day-${cssEscape(dateStr)}`
  );
  if (!target) return;
  // Compute the target's offset relative to the container's scroll origin.
  const containerTop = container.getBoundingClientRect().top;
  const targetTop = target.getBoundingClientRect().top;
  const top = container.scrollTop + (targetTop - containerTop);
  // scrollTo({behavior:'smooth'}) on internal containers is hit-or-miss on
  // iOS Safari. Direct scrollTop assignment is universally supported.
  if (behavior === "smooth" && "scrollTo" in container) {
    try {
      container.scrollTo({ top, behavior: "smooth" });
      return;
    } catch {
      // fallthrough to assignment
    }
  }
  container.scrollTop = top;
}

// CSS.escape with a tiny fallback for older Safari.
function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function parseLocalDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return format(dt, "yyyy-MM-dd");
}

function labelLong(yyyyMmDd: string): string {
  return parseLocalDate(yyyyMmDd).toLocaleDateString(undefined, {
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

function visibleOnDay(
  inst: DayInstance,
  dayStr: string,
  todayStr: string
): boolean {
  const r = inst.activity.rhythm;
  if (r.type === "single") {
    // Overdue singles surface on today only; non-overdue on their own day.
    if (inst.scheduled_for < todayStr) return dayStr === todayStr;
    return inst.scheduled_for === dayStr;
  }
  if (r.type !== "frequency") return inst.scheduled_for === dayStr;
  if (r.period === "day") return inst.scheduled_for === dayStr;

  const day = parseLocalDate(dayStr);
  const scheduled = parseLocalDate(inst.scheduled_for);
  if (r.period === "week") {
    const dayOfWeek = day.getDay(); // 0=Sun, 1=Mon...
    const offset = (dayOfWeek + 6) % 7; // days since Monday
    const monday = new Date(day);
    monday.setDate(day.getDate() - offset);
    return scheduled >= monday && scheduled <= day;
  }
  // month
  const monthStart = new Date(day.getFullYear(), day.getMonth(), 1);
  return scheduled >= monthStart && scheduled <= day;
}

function compareForDay(a: DayInstance, b: DayInstance): number {
  const ta = a.activity.scheduled_times[0] ?? "99:99";
  const tb = b.activity.scheduled_times[0] ?? "99:99";
  if (ta !== tb) return ta.localeCompare(tb);
  const pa = a.activity.priority ?? 2;
  const pb = b.activity.priority ?? 2;
  if (pa !== pb) return pa - pb;
  return a.activity.name.localeCompare(b.activity.name);
}
