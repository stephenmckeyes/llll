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

import { summarizeRhythm } from "@/lib/domain/rhythm-summary";
import {
  normalizeFrequencyPeriod,
  type Rhythm,
} from "@/lib/validators/rhythm";

import { ActivityModal } from "./activity-modal";
import { IncompleteButton, type IncompleteInfo } from "./incomplete-button";
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

// A row in the Completed/Missed dropdown. Holds the full DayInstance so
// the row click can open the same ActivityModal a pending row would
// open — no follow-up fetch needed.
export type DayMarkedItem = {
  id: string;
  instance: DayInstance;
};

export function DayList({
  initialDate,
  instances,
  completedByDate,
  missedByDate,
  todayStr,
  incompleteInfo,
}: {
  initialDate: string;
  completedByDate: Record<string, DayMarkedItem[]>;
  missedByDate: Record<string, DayMarkedItem[]>;
  instances: DayInstance[];
  todayStr: string;
  incompleteInfo: IncompleteInfo;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [dateInputValue, setDateInputValue] = useState(initialDate);
  const [openInstance, setOpenInstance] = useState<DayInstance | null>(null);

  // Optimistic "I just clicked complete/missed" set. Drives instant UI
  // feedback so the user doesn't sit watching the row for ~6 seconds
  // while the server action + revalidation round-trips. We reset the
  // set on every fresh `instances` prop change — once the server returns
  // a list that no longer contains the pending instance, the optimistic
  // hide is no longer needed (and would be stale if we kept it).
  const [optimisticIds, setOptimisticIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const instancesKey = instances.map((i) => `${i.id}:${i.completionCount}`).join(",");
  const [lastKey, setLastKey] = useState(instancesKey);
  if (lastKey !== instancesKey) {
    setLastKey(instancesKey);
    setOptimisticIds(new Set());
  }

  const dispatchOptimistic = useCallback((id: string) => {
    setOptimisticIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Group instances by date for fast lookup, filtering archived AND
  // optimistically-dispatched rows.
  const live = useMemo(
    () =>
      instances.filter(
        (i) => !i.activity.archived_at && !optimisticIds.has(i.id)
      ),
    [instances, optimisticIds]
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
  // externally (e.g., the user used the View Switcher to navigate and
  // came back). Done as derived state during render rather than in an
  // effect — React 19 lints `useEffect(() => setX(prop), [prop])`
  // because it triggers a cascading render. The snapshot below lets us
  // detect the prop change exactly once per change.
  const [initialDateSnapshot, setInitialDateSnapshot] = useState(initialDate);
  if (initialDateSnapshot !== initialDate) {
    setInitialDateSnapshot(initialDate);
    setCurrentDate(initialDate);
    setDateInputValue(initialDate);
  }

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
          scrolls.
          Two rows: friendly label on top, [← date-input → Today] below.
          The arrows hug a FIXED-WIDTH date input (not the variable-width
          friendly label), so they stay in EXACTLY the same screen position
          when the user steps day-by-day. "Saturday, May 23, 2026" being
          longer than "Friday, May 22, 2026" no longer drags the right
          arrow with it. The label moved to its own row so changes in its
          width can't shift the arrows below. */}
      <div className="flex flex-col gap-1">
        <p className="text-center text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {labelLong(currentDate)}
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => shiftDays(-1)}
            aria-label="Previous day"
            className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            ←
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
            onClick={() => shiftDays(1)}
            aria-label="Next day"
            className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => jumpTo(todayStr)}
            className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Today
          </button>
          <IncompleteButton info={incompleteInfo} />
        </div>
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
              completed={completedByDate[d.dateStr] ?? []}
              missed={missedByDate[d.dateStr] ?? []}
              todayStr={todayStr}
              onOpenInstance={setOpenInstance}
              onDispatchOptimistic={dispatchOptimistic}
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
  completed,
  missed,
  todayStr,
  onOpenInstance,
  onDispatchOptimistic,
}: {
  date: Date;
  dateStr: string;
  visible: DayInstance[];
  completed: DayMarkedItem[];
  missed: DayMarkedItem[];
  todayStr: string;
  onOpenInstance: (inst: DayInstance) => void;
  onDispatchOptimistic: (id: string) => void;
}) {
  const isToday = dateStr === todayStr;
  const totalMarked = completed.length + missed.length;
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

      {/* "Completed/Missed" dropdown — renders on EVERY day, even when
          the count is zero, so the layout stays consistent and the user
          can scan history at a glance. Native <details>/<summary> for
          accessibility + collapse-state with no client React state.
          Inside: two sub-tables (Completed, Missed) so the user can see
          what they did and what they actively gave up on, both bucketed
          to the day they were scheduled for (NOT to the click date).
          Each row is a button that opens the same ActivityModal a
          pending row opens — so you can revert a misclick (e.g. fix
          "completed" → "missed", add notes, etc.) the same way. */}
      <details className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
          Completed/Missed ({totalMarked})
        </summary>
        <div className="mt-2 flex flex-col gap-3">
          <MarkedTable
            kind="completed"
            items={completed}
            onOpen={onOpenInstance}
          />
          <MarkedTable
            kind="missed"
            items={missed}
            onOpen={onOpenInstance}
          />
        </div>
      </details>
      {/* If there's nothing scheduled for the day, render NOTHING — not
          even a "Free" placeholder. The day header + completed/missed
          dropdown alone communicate "empty day" cleanly without adding
          a hollow card every row. */}
      {visible.length > 0 && (
        <div className="flex flex-col gap-2">
          {visible.map((inst) => (
            <InstanceRow
              key={inst.id}
              instance={inst}
              todayStr={todayStr}
              onOpen={() => onOpenInstance(inst)}
              onDispatchOptimistic={onDispatchOptimistic}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// MarkedTable — one sub-section inside the Completed/Missed dropdown.
// Each row is a button so a misclick can be reverted via the same modal
// that pending rows use.
// ---------------------------------------------------------------------------

function MarkedTable({
  kind,
  items,
  onOpen,
}: {
  kind: "completed" | "missed";
  items: DayMarkedItem[];
  onOpen: (inst: DayInstance) => void;
}) {
  const title = kind === "completed" ? "Completed" : "Missed";
  const headerCls =
    kind === "completed"
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-red-700 dark:text-red-300";
  const swatch =
    kind === "completed"
      ? "bg-emerald-500"
      : "bg-red-500";

  if (items.length === 0) {
    return (
      <div>
        <p
          className={`text-[10px] font-medium uppercase tracking-wide ${headerCls}`}
        >
          {title} (0)
        </p>
        <p className="mt-1 text-xs italic text-zinc-500">None.</p>
      </div>
    );
  }

  return (
    <div>
      <p
        className={`text-[10px] font-medium uppercase tracking-wide ${headerCls}`}
      >
        {title} ({items.length})
      </p>
      <ul className="mt-1 flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onOpen(it.instance)}
              title="Click to open — you can revert or edit"
              className="flex w-full min-w-0 items-start gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
            >
              <span
                aria-hidden
                className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${swatch}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-zinc-800 dark:text-zinc-200">
                  {it.instance.activity.name}
                </span>
                <span className="block truncate text-[11px] text-zinc-500">
                  {summarizeRhythm(
                    it.instance.activity.rhythm,
                    it.instance.activity.scheduled_times
                  )}
                </span>
                {it.instance.activity.notes && (
                  <span className="block truncate text-[11px] text-zinc-500">
                    {it.instance.activity.notes}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
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

  // Frequency periods are anchored to scheduled_for and last for
  // perCount * perUnit. Show the instance on any day inside that range.
  const { perCount, perUnit } = normalizeFrequencyPeriod(r);
  const scheduled = parseLocalDate(inst.scheduled_for);
  const periodEnd = advanceLocalDate(scheduled, perCount, perUnit);
  const day = parseLocalDate(dayStr);
  return day >= scheduled && day < periodEnd;
}

function advanceLocalDate(d: Date, count: number, unit: string): Date {
  const out = new Date(d);
  if (unit === "days") out.setDate(out.getDate() + count);
  else if (unit === "weeks") out.setDate(out.getDate() + count * 7);
  else if (unit === "months") out.setMonth(out.getMonth() + count);
  return out;
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
