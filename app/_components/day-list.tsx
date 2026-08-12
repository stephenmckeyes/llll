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
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { unlabelInstance } from "@/app/actions/activities";
import { acknowledgeConflict } from "@/app/actions/conflicts";
import { type AddActivityDensity } from "@/lib/domain/add-activity-density";
import {
  frequencyDueDay,
  frequencyPeriodEnd,
} from "@/lib/domain/frequency-period";
import { summarizeRhythm } from "@/lib/domain/rhythm-summary";
import type { TagMap } from "@/lib/domain/tags";
import { formatTimeRange } from "@/lib/ui/format-time";
import { useTimeFormat } from "@/lib/ui/format-time-client";
import { type Rhythm } from "@/lib/validators/rhythm";

import { ActivityModal } from "./activity-modal";
import { CommentModal } from "./comment-modal";
import { IncompleteButton, type IncompleteInfo } from "./incomplete-button";
import { InlineAddRow } from "./inline-add-row";
import { InstanceRow } from "./instance-row";
import { NewActivityModal } from "./new-activity-modal";
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

const DAY_VIEW_BACK = 90;
const DAY_VIEW_AHEAD = 180;
const TOTAL_DAYS = DAY_VIEW_BACK + 1 + DAY_VIEW_AHEAD;

export type DayInstance = {
  id: string;
  scheduled_for: string;
  /** Current verdict. Drives the modal's action bar — a completed or
   *  missed occurrence offers "Unlabel" (revert to pending) in place of
   *  the verdict it already carries. */
  status: "pending" | "completed" | "missed";
  completionCount: number;
  /** Tag NAMES snapshotted at instance generation. Per-instance —
   *  doesn't change when the activity's `default_skill_tags` is
   *  edited via Edit Activity. Edit Rhythm regenerates pending future
   *  instances and they pick up the fresh snapshot. */
  tags: string[];
  /** Per-occurrence overrides set by "Edit activity" (NULL = inherit
   *  from the parent activity). Display uses `overrideX ?? activity.X`;
   *  "Edit rhythm" edits the series and ignores these. Editing one
   *  occurrence never touches any other occurrence. */
  overrideName: string | null;
  overrideNotes: string | null;
  overridePriority: number | null;
  /** Post-hoc reflection about THIS occurrence — freely editable via the
   *  Comment button on the row's resolved state, the dropdown row, and
   *  the modal. NULL / empty = no comment. Shared with friends who have
   *  share_progress on the parent activity. */
  comment: string | null;
  activity: {
    id: string;
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    priority: number;
    scheduled_times: string[];
    /** Parallel to scheduled_times (migration 0032). Empty string in
     *  a slot = "no end time" for that occurrence. Optional so
     *  callers that don't fetch the column still typecheck; display
     *  code treats missing / short as trailing "". */
    scheduled_end_times?: string[];
    /** Activity's CURRENT tag set. Use this for activity-level
     *  surfaces (modal details, edit form, archive cards). For
     *  per-occurrence surfaces (Day banner, Week dots, Month dots),
     *  read from the instance's `tags` snapshot instead. */
    default_skill_tags: string[];
    start_date: string;
    end_date: string | null;
    archived_at: string | null;
    reminders: Array<{ amount: number; unit: string }>;
    /** Show this activity on the Grid (Settings → Streaks unrelated;
     *  see migration 0016). Needed so Edit Rhythm can prefill the
     *  Track-on-Grid toggle. */
    track_on_grid: boolean;
    /** Rollover-on-missed toggles (migration 0021). Needed so Edit
     *  Rhythm can prefill them AND so the field-set type stays in sync
     *  with ActivityFormInitial. Both default false. */
    rollover_missed_days: boolean;
    rollover_change_rhythm: boolean;
    /** Auto-archive on completion (migration 0026). */
    auto_archive: boolean;
  };
};

// A row in the Completed/Missed dropdown. Holds the full DayInstance so
// the row click can open the same ActivityModal a pending row would
// open — no follow-up fetch needed.
//
// For non-frequency rhythms each entry is one whole instance (id ==
// instance id). For frequency rhythms each LIVE COMPLETION becomes its
// own row (id is a synthetic `${instanceId}:${completionId}` so React
// can distinguish them) and the inline Unlabel button is hidden, because
// unlabelInstance() nukes every completion on the instance — destructive
// when the user only meant to undo one. The modal still opens normally
// and exposes the granular goal/progress controls there.
export type DayMarkedItem = {
  /** Stable React key. May be a synthetic ID for per-completion entries. */
  id: string;
  /** The real activity_instance ID — what unlabelInstance() takes. */
  instanceId: string;
  /** If true, the inline "Unlabel" button is omitted (see comment above).
   *  Default false / undefined → button shown as before. */
  hideInlineUnlabel?: boolean;
  instance: DayInstance;
};

export function DayList({
  initialDate,
  instances,
  completedByDate,
  missedByDate,
  todayStr,
  incompleteInfo,
  tagMap,
  readOnly = false,
  onReadOnlyOpen,
  onUnlabeledJump,
  density = "compact",
  chipsSlot,
  timelineMode = false,
  acknowledgedPairKeys = [],
  untimedOpenDefault = false,
}: {
  initialDate: string;
  completedByDate: Record<string, DayMarkedItem[]>;
  missedByDate: Record<string, DayMarkedItem[]>;
  instances: DayInstance[];
  todayStr: string;
  incompleteInfo: IncompleteInfo;
  tagMap: TagMap;
  /** Optional accessory rendered at the far right of the date-input
   *  row (same line as ← input → Today Unlabeled). The dashboard passes
   *  the Calendar's Timeline + Filters chips here so they sit next to
   *  the Today button per user spec. */
  chipsSlot?: React.ReactNode;
  /** When true, each DaySection swaps its middle render: timed
   *  pending instances plot into an hour grid, untimed pending render
   *  as regular InstanceRow rows below the grid. Completed/Missed
   *  dropdown, InlineAdd, and every other DayList capability stay the
   *  same — Timeline is a display variant, not a parallel system. */
  timelineMode?: boolean;
  /** Cross-device conflict-ack pair keys from migration 0036. When
   *  set + timelineMode, DayList detects today's overlapping timed
   *  pairs and surfaces an ack banner at the top of the scroll
   *  container. Client-side ack calls the acknowledgeConflict
   *  server action. */
  acknowledgedPairKeys?: readonly string[];
  /** Migration 0037. Whether the per-day untimed dropdown starts
   *  expanded. Only meaningful in timelineMode. */
  untimedOpenDefault?: boolean;
  /** Read-only friend view: same infinite-scroll day list, but no
   *  Complete/Missed/Unlabel/+Add and no mutation modals — rows show a
   *  static status. Default false keeps the dashboard unchanged. */
  readOnly?: boolean;
  /** In read-only mode, tapping a row calls this (instead of opening the
   *  owner-only mutation modal) so the friend view can show its own
   *  read-only detail. */
  onReadOnlyOpen?: (inst: DayInstance) => void;
  /** In read-only mode, wiring this makes the "Unlabeled (N)" chip
   *  show and jump to the friend's oldest past-due date via a client
   *  callback (their friend view keeps sub + date as client state
   *  rather than URL params, so a Link won't reach it). */
  onUnlabeledJump?: (date: string) => void;
  /** Add Activity form density (migration 0023). Applied to the two
   *  mutation modals below (NewActivityModal + ActivityModal's edit
   *  bodies) so a user who picked Compact sees the condensed form
   *  everywhere Add-Activity happens, not just on /activities/new.
   *  Optional — read-only friend contexts leave it default. */
  density?: AddActivityDensity;
}) {
  const router = useRouter();
  const [, startUnlabelTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [currentDate, setCurrentDate] = useState(initialDate);
  const [dateInputValue, setDateInputValue] = useState(initialDate);
  const [openInstance, setOpenInstance] = useState<DayInstance | null>(null);
  // Which day's "+ Add activity" placeholder was tapped (null = closed).
  // Opens NewActivityModal pre-dated to that day.
  const [addDay, setAddDay] = useState<string | null>(null);

  // "I just resolved this" map: instanceId → "completed" | "missed".
  //
  // We DON'T remove resolved rows from the list — we mark them in place
  // (dimmed, with a status pill). Removing them caused the list to
  // reflow under the user's finger during rapid down-the-list tapping:
  // tap row A, A vanishes, B jumps into A's spot, the next tap lands on
  // B instead of where the user aimed. Keeping the row's slot stable
  // fixes that. The map resets on every fresh `instances` prop (a real
  // navigation / refresh), at which point resolved rows have moved into
  // the Completed/Missed dropdown server-side.
  const [resolved, setResolved] = useState<
    ReadonlyMap<string, "completed" | "missed">
  >(new Map());
  // scheduled_for is in the key so the resolved map ALSO clears when a
  // row moves (missInstance on a single reschedules to a new date). Left
  // out, a rescheduled instance would keep its stale "✗ Missed" pill on
  // its new day until a manual refresh.
  const instancesKey = instances
    .map((i) => `${i.id}:${i.scheduled_for}:${i.completionCount}`)
    .join(",");
  const [lastKey, setLastKey] = useState(instancesKey);
  if (lastKey !== instancesKey) {
    setLastKey(instancesKey);
    setResolved(new Map());
  }

  const markResolved = useCallback(
    (id: string, status: "completed" | "missed") => {
      setResolved((prev) => {
        const next = new Map(prev);
        next.set(id, status);
        return next;
      });
    },
    []
  );

  // Undo a mark-in-place resolution (the "Unlabel" button on a row the
  // user just completed/missed). Drops the entry so the row re-renders
  // with its Complete/Missed buttons; the server-side revert is fired by
  // the row itself via unlabelInstance.
  const clearResolved = useCallback((id: string) => {
    setResolved((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Unlabel a row that's ALREADY in the Completed/Missed dropdown (resolved
  // in a previous session / before the last refresh). Unlike the in-place
  // revert above, these rows are server-rendered into the dropdown, so we
  // revert on the server then router.refresh() to move the row back into
  // the active list. This is a deliberate one-off correction (not the
  // rapid-tap path), so a soft refresh here is fine.
  const handleDropdownUnlabel = useCallback(
    (id: string) => {
      startUnlabelTransition(async () => {
        await unlabelInstance(id);
        router.refresh();
      });
    },
    [router]
  );

  // Group instances by date for fast lookup. Archived activities are
  // filtered out; resolved rows STAY (rendered as done in place).
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

  // Snap the scroll to `initialDate` on mount. Because DayList gets
  // a `key={timelineMode ? "timeline" : "normal"}` from its parent,
  // toggling Timeline REMOUNTS this component — so this effect
  // always sees a fresh container with scrollTop=0.
  //
  // iOS Safari specifically:
  //   - scrollTop assignments can be silently dropped on freshly-
  //     mounted containers until the compositor commits the scroll
  //     layer. Workaround: read container.offsetHeight before every
  //     write (forces layer promotion + reflow).
  //   - `scrollIntoView` is more reliable than manual scrollTop
  //     math on iOS. Try it first; fall back to scrollTop if the
  //     target still isn't at container top afterwards.
  //   - Layout of ~200,000 px of hour-grid DOM streams in over
  //     many more frames than on desktop.
  const isFirstMountRef = useRef(true);
  useLayoutEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    // Hard-reset scroll only on subsequent runs (Timeline toggle,
    // initialDate change). On the FIRST mount the pre-hydration
    // <script> serialized after the container has already set
    // scrollTop to today's offsetTop — undoing that here would
    // reintroduce the flash of windowStart (May 12) we're trying
    // to avoid. Retries still run, but doScroll's first attempt
    // sees target already at top and settles immediately.
    if (!isFirstMountRef.current) {
      container.scrollTop = 0;
    }
    isFirstMountRef.current = false;

    // Two flags that STOP the retry machinery:
    //   - `settled`  = we verified target lands within 5 px of top
    //   - `userTook` = user touched the container / dispatched a real
    //                  scroll event that wasn't from our writes
    // Either one shuts down retries so we never fight the user's
    // scrolling. Without this, ResizeObserver ticks (fired every
    // time content-visibility promotes an offscreen section) and
    // the setTimeout sweep would snap the user back to today.
    let settled = false;
    let userTook = false;

    const targetSelector = `#day-${cssEscape(initialDate)}`;

    const isTargetAtTop = (): boolean => {
      const target = container.querySelector<HTMLElement>(targetSelector);
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return Math.abs(rect.top - containerRect.top) <= 5;
    };

    const doScroll = () => {
      if (cancelled || settled || userTook) return;
      const target = container.querySelector<HTMLElement>(targetSelector);
      if (!target) return;

      // iOS layer-promotion: force reflow before the write.
      void container.offsetHeight;

      // Mark that the NEXT scroll event was fired by us (via a small
      // window of time), so the user-scroll detector doesn't confuse
      // our own writes for user input.
      lastProgrammaticScrollAt = performance.now();

      try {
        target.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });
      } catch {
        /* fall through */
      }

      requestAnimationFrame(() => {
        if (cancelled || userTook) return;
        if (!isTargetAtTop()) {
          lastProgrammaticScrollAt = performance.now();
          scrollContainerTo(container, initialDate);
        }
        // Verify one more frame later — if we landed, mark settled
        // so nothing else retries.
        requestAnimationFrame(() => {
          if (cancelled || userTook) return;
          if (isTargetAtTop()) settled = true;
        });
      });
    };

    // Distinguish user scrolls from our own. A scroll event within
    // ~200 ms of a programmatic write is ours. Anything else is the
    // user, and we bail out of the retry loop immediately.
    // Seed with `now` so the pre-hydration inline script's own scroll
    // event (fired during HTML parse, delivered on first tick after
    // hydration) doesn't get misclassified as a user scroll and kill
    // the retry loop.
    let lastProgrammaticScrollAt = performance.now();
    const onScroll = () => {
      if (cancelled) return;
      const dt = performance.now() - lastProgrammaticScrollAt;
      if (dt > 200) {
        userTook = true;
      }
    };
    // Also treat any direct touch on the container as user intent —
    // catches the case where iOS Safari fires touch events before
    // any scroll event.
    const onTouch = () => {
      if (cancelled) return;
      userTook = true;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("touchstart", onTouch, { passive: true });
    container.addEventListener("wheel", onTouch, { passive: true });

    // Attempt 1: sync.
    doScroll();

    // Attempts 2–3: next two frames.
    const raf1 = requestAnimationFrame(() => {
      doScroll();
      requestAnimationFrame(doScroll);
    });

    // Attempts 4+: on ResizeObserver ticks, but ONLY if not settled
    // and the user hasn't scrolled.
    let lastContentHeight = container.scrollHeight;
    let lastContainerHeight = container.clientHeight;
    const observer = new ResizeObserver(() => {
      if (cancelled || settled || userTook) return;
      const h = container.scrollHeight;
      const c = container.clientHeight;
      if (h !== lastContentHeight || c !== lastContainerHeight) {
        lastContentHeight = h;
        lastContainerHeight = c;
        doScroll();
      }
    });
    observer.observe(container);
    const content = container.firstElementChild;
    if (content) observer.observe(content);

    // Timer sweep for slow iOS layout — also short-circuited by
    // settled / userTook.
    const timers = [50, 200, 500, 1000, 2000, 4000].map((ms) =>
      setTimeout(() => {
        if (cancelled || settled || userTook) return;
        doScroll();
      }, ms)
    );

    // Tear down observer after 5 s regardless.
    const disconnectTimer = setTimeout(() => observer.disconnect(), 5000);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      timers.forEach(clearTimeout);
      clearTimeout(disconnectTimer);
      observer.disconnect();
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("touchstart", onTouch);
      container.removeEventListener("wheel", onTouch);
    };
    // `timelineMode` is in deps so toggling the mode re-runs the
    // initial-scroll flow: DayList is NOT remounted on toggle
    // (that caused a 271-section tear-down flash on desktop), so
    // we rely on this effect firing to reset scrollTop and re-
    // anchor to `initialDate` when the sections' heights change.
  }, [initialDate, timelineMode]);

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

  // Silently mirror the currently-viewed day back into the URL as
  // ?date=<currentDate>. Uses history.replaceState (no navigation,
  // no re-render, no new history entry) — the URL just tracks where
  // the user is looking so:
  //   - The Timeline / Filters chips can generate hrefs that PRESERVE
  //     the current day when toggled, instead of always jumping to
  //     today.
  //   - Refresh / share URL includes the current day (bookmarkable).
  //
  // Cold-open protection is upstream in page.tsx: `sec-fetch-site ===
  // "none"` + any stale `?date` redirects to `/`. So bookmarkable
  // dates don't outlive a cold open — user still lands on today when
  // they open the app fresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("date") === currentDate) return;
    url.searchParams.set("date", currentDate);
    window.history.replaceState(window.history.state, "", url.toString());
  }, [currentDate]);

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
        // Preserve the timeline flag so the Today button doesn't
        // silently exit Timeline mode when today happens to fall
        // outside the current initialDate's ±window.
        const suffix = timelineMode ? "&timeline=1" : "";
        router.push(`/?view=day&date=${dateStr}${suffix}`);
        return;
      }
      // Use container.scrollTo on the actual scroll element. iOS Safari
      // handles native scrollTo reliably; scrollIntoView({behavior:"smooth"})
      // does not always animate / scroll inside an internal container.
      scrollContainerTo(containerRef.current, dateStr, "smooth");
    },
    [router, windowStart, windowEnd, timelineMode]
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
          width can't shift the arrows below.
          Absolute-positioned "< MMM YYYY" back link on the left drills
          up to Month view for the currently-viewed day — same target as
          tapping the Month section tab, but without losing your place.
          Mirrors iPhone Calendar's drill-up affordance. */}
      <div className="relative flex flex-col gap-1">
        {!readOnly && (
          <Link
            href={`/?view=month&date=${currentDate}`}
            className="absolute left-0 top-0 shrink-0 text-base font-semibold leading-tight text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            aria-label={`Go to month view of ${format(parseLocalDate(currentDate), "MMMM yyyy")}`}
          >
            ‹ {format(parseLocalDate(currentDate), "MMM yyyy")}
          </Link>
        )}
        <p className="text-center text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {labelLong(currentDate)}
        </p>
        <div className="flex items-center gap-2">
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
          {/* The Unlabeled chip's default Link points at the user's OWN
              day view. In read-only friend mode the chip only shows
              when the friend calendar wires up an `onUnlabeledJump`
              callback — which replaces the Link with a client-side
              jump into that friend's Day sub-view. */}
          {readOnly ? (
            onUnlabeledJump && (
              <IncompleteButton
                info={incompleteInfo}
                onJump={onUnlabeledJump}
              />
            )
          ) : (
            <IncompleteButton info={incompleteInfo} />
          )}
          {/* Chips slot — right-aligned via ml-auto so the date
              controls keep their left grouping and Timeline/Filters
              float to the end of the same row. */}
          {chipsSlot && <div className="ml-auto shrink-0">{chipsSlot}</div>}
        </div>
      </div>

      {/* Scrollable list.
          `h-[60vh]` (with vh, not svh) is intentional: iOS Safari before
          15.4 doesn't support svh; without an explicit height the container
          grows to its content and the whole page scrolls instead of the
          list — which is what was making rows un-tappable on mobile. */}
      <div
        ref={containerRef}
        data-day-scroll="true"
        // Vertical scroll only. `overflow-x-hidden` clips any sideways
        // overflow and `touch-pan-y` tells the browser to honor only
        // up/down panning gestures — so a slightly-diagonal swipe never
        // scrolls the list left/right.
        //
        // `overflow-anchor: none` disables the browser's scroll-
        // anchoring heuristic. Without this, when Timeline toggles and
        // section heights change ~4×, iOS Safari (and Chrome to a
        // lesser extent) tries to preserve the user's viewing position
        // by adjusting scrollTop — which lands them on the wrong date
        // proportional to the layout ratio (e.g. Jan 4 → July 14 on
        // enter-timeline; July 10 → Dec 24 on exit). We want the
        // initial-scroll effect to place the user, not the browser.
        style={{ overflowAnchor: "none" }}
        className="h-[60vh] min-h-[20rem] touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain pr-2 sm:h-[68vh]"
      >
        <div className="flex flex-col gap-4">
          {timelineMode && (
            <TimelineConflictBanners
              todayStr={todayStr}
              instances={live}
              acknowledgedPairKeys={acknowledgedPairKeys}
              onOpenInstance={
                readOnly ? onReadOnlyOpen ?? (() => {}) : setOpenInstance
              }
            />
          )}
          {days.map((d) => (
            <DaySection
              key={d.dateStr}
              date={d.date}
              dateStr={d.dateStr}
              visible={d.visible}
              completed={completedByDate[d.dateStr] ?? []}
              missed={missedByDate[d.dateStr] ?? []}
              todayStr={todayStr}
              onOpenInstance={
                readOnly ? onReadOnlyOpen ?? (() => {}) : setOpenInstance
              }
              resolved={resolved}
              onResolve={markResolved}
              onUnresolve={clearResolved}
              onDropdownUnlabel={handleDropdownUnlabel}
              onAdd={setAddDay}
              readOnly={readOnly}
              tagMap={tagMap}
              timelineMode={timelineMode}
              untimedOpenDefault={untimedOpenDefault}
            />
          ))}
        </div>
      </div>
      {/* Pre-hydration scroll anchor.
          SSR ships this <script> serialized *after* all day sections,
          so when the browser parses the HTML it can already resolve
          `#day-${initialDate}` and set the scroll container's
          scrollTop before the first paint. Result: cold-open lands
          on today with no visible flash of windowStart (May 12).
          React ignores <script> during hydration; our useLayoutEffect
          also skips its scrollTop=0 reset on the first run so it
          doesn't undo what this script already did. */}
      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var s=document.getElementById('day-${initialDate}');if(!s)return;var c=s.closest('[data-day-scroll]');if(!c)return;c.scrollTop=s.offsetTop;}catch(e){}})();`,
        }}
      />

      {/* Mutation modals never mount in read-only mode (openInstance /
          addDay can't be set there). */}
      {!readOnly && openInstance && (
        <ActivityModal
          instance={openInstance}
          todayStr={todayStr}
          onClose={() => setOpenInstance(null)}
          tagMap={tagMap}
          density={density}
        />
      )}

      {!readOnly && addDay && (
        <NewActivityModal
          startDate={addDay}
          tagMap={tagMap}
          onClose={() => setAddDay(null)}
          density={density}
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
  resolved,
  onResolve,
  onUnresolve,
  onDropdownUnlabel,
  onAdd,
  readOnly,
  tagMap,
  timelineMode = false,
  untimedOpenDefault = false,
}: {
  date: Date;
  dateStr: string;
  visible: DayInstance[];
  completed: DayMarkedItem[];
  missed: DayMarkedItem[];
  todayStr: string;
  onOpenInstance: (inst: DayInstance) => void;
  resolved: ReadonlyMap<string, "completed" | "missed">;
  onResolve: (id: string, status: "completed" | "missed") => void;
  onUnresolve: (id: string) => void;
  onDropdownUnlabel: (id: string) => void;
  onAdd: (dateStr: string) => void;
  readOnly: boolean;
  tagMap: TagMap;
  /** Timeline variant — replaces the flat instance-row list with an
   *  hour-grid for timed pending instances + a row list for the
   *  untimed remainder. Completed/Missed dropdown, day header, and
   *  the InlineAdd row are unchanged. */
  timelineMode?: boolean;
  /** Initial open/closed state for the untimed <details> (only used
   *  in timelineMode). Migration 0037 → Settings picker. */
  untimedOpenDefault?: boolean;
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
            onUnlabel={onDropdownUnlabel}
            readOnly={readOnly}
          />
          <MarkedTable
            kind="missed"
            items={missed}
            onOpen={onOpenInstance}
            onUnlabel={onDropdownUnlabel}
            readOnly={readOnly}
          />
        </div>
      </details>
      {/* Timeline variant: split visible into TIMED (has scheduled
          start times → hour-grid blocks) and UNTIMED (no time → row
          list). Both open the SAME ActivityModal via onOpenInstance,
          so Complete/Missed/Unlabel/Comment all work identically.
          Non-timeline: unchanged flat instance-row list. */}
      {timelineMode ? (
        <TimelineDayBody
          visible={visible}
          resolved={resolved}
          onOpenInstance={onOpenInstance}
          onResolve={onResolve}
          onUnresolve={onUnresolve}
          readOnly={readOnly}
          tagMap={tagMap}
          todayStr={todayStr}
          untimedOpenDefault={untimedOpenDefault}
        />
      ) : (
        visible.length > 0 && (
          <div className="flex flex-col gap-2">
            {visible.map((inst) => (
              <InstanceRow
                key={inst.id}
                instance={inst}
                todayStr={todayStr}
                onOpen={() => onOpenInstance(inst)}
                resolution={resolved.get(inst.id) ?? null}
                onResolve={onResolve}
                onUnresolve={onUnresolve}
                readOnly={readOnly}
                tagMap={tagMap}
              />
            ))}
          </div>
        )
      )}

      {/* Inline "+ Add activity" — type a name directly and commit on
          Enter / tap-off / ✓. The circled "i" button opens the full
          NewActivityModal for everything the inline input can't capture
          (time, tags, rhythm, priority, on-grid, etc.). Hidden in the
          read-only friend view — you can't add to a friend's schedule. */}
      {!readOnly && (
        <InlineAddRow dateStr={dateStr} onOpenModal={() => onAdd(dateStr)} />
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
  onUnlabel,
  readOnly,
}: {
  kind: "completed" | "missed";
  items: DayMarkedItem[];
  onOpen: (inst: DayInstance) => void;
  onUnlabel: (id: string) => void;
  readOnly: boolean;
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
          <MarkedRow
            key={it.id}
            it={it}
            swatch={swatch}
            onOpen={onOpen}
            onUnlabel={onUnlabel}
            readOnly={readOnly}
          />
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MarkedRow — one row inside a MarkedTable. Split out into its own
// component so it can carry a per-row Comment modal state without
// hoisting a Map<id, boolean> up to the parent.
// ---------------------------------------------------------------------------

function MarkedRow({
  it,
  swatch,
  onOpen,
  onUnlabel,
  readOnly,
}: {
  it: DayMarkedItem;
  swatch: string;
  onOpen: (inst: DayInstance) => void;
  onUnlabel: (id: string) => void;
  readOnly: boolean;
}) {
  const [commentOpen, setCommentOpen] = useState(false);
  return (
    <li className="flex items-stretch gap-1">
      <button
        type="button"
        onClick={() => onOpen(it.instance)}
        title={
          readOnly
            ? "Tap to view details"
            : "Click to open — you can revert or edit"
        }
        className="flex min-w-0 flex-1 items-start gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
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
          {/* Comment preview — the reflection the user (or shared owner)
              wrote about this occurrence. Truncates to one line here; the
              modal shows the full text and lets the owner edit. Owner-
              side surfaces highlight the comment with a subtle "italic
              quote" tone so it visually distinguishes from the notes
              lines above. */}
          {it.instance.comment && (
            <span className="mt-0.5 block truncate text-[11px] italic text-zinc-600 dark:text-zinc-400">
              “{it.instance.comment}”
            </span>
          )}
        </span>
      </button>
      {/* Owner-only: Comment (add / edit reflection). Hidden for
          read-only friend view — friends can view the comment via the
          preview above but can't edit. */}
      {!readOnly && (
        <button
          type="button"
          onClick={() => setCommentOpen(true)}
          title={
            it.instance.comment
              ? "Edit your reflection"
              : "Add a reflection — shared with anyone this activity is shared with"
          }
          className={`shrink-0 touch-manipulation rounded-md border px-2 text-[11px] font-medium transition-colors ${
            it.instance.comment
              ? "border-zinc-900 text-zinc-900 hover:bg-zinc-100 dark:border-zinc-50 dark:text-zinc-50 dark:hover:bg-zinc-900"
              : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
          }`}
        >
          {it.instance.comment ? "✓" : "Comment"}
        </button>
      )}
      {/* Quick revert — sends this occurrence back to pending (out of
          the dropdown, back into the active list) without opening the
          modal. Hidden in the read-only friend view, and on per-
          completion frequency rows where the all-or-nothing instance
          reset would wipe the user's other completions too (see
          DayMarkedItem.hideInlineUnlabel). */}
      {!readOnly && !it.hideInlineUnlabel && (
        <button
          type="button"
          onClick={() => onUnlabel(it.instanceId)}
          title="Tapped by accident? Revert to pending."
          className="shrink-0 touch-manipulation rounded-md border border-zinc-200 px-2 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          Unlabel
        </button>
      )}
      {commentOpen && (
        <CommentModal
          instanceId={it.instanceId}
          activityName={it.instance.activity.name}
          initialComment={it.instance.comment}
          onClose={() => setCommentOpen(false)}
        />
      )}
    </li>
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
    // Overdue singles render on BOTH today AND their original
    // scheduled_for. Why both:
    //   - on today: the "still demanding attention" surface so the
    //     row keeps prodding the user from the current view.
    //   - on scheduled_for: so the "Unlabeled (N)" chip — which
    //     routes to the oldest pending's scheduled_for — actually
    //     lands the user on a section that contains the row. Without
    //     this, clicking the chip went to an empty past day for
    //     singles.
    // The day-list never has two distant days on screen at once, so
    // the duplication isn't visually confusing; if the user marks the
    // row complete/missed from either section, optimistic-hide +
    // revalidation drop it everywhere.
    if (inst.scheduled_for < todayStr) {
      return dayStr === todayStr || dayStr === inst.scheduled_for;
    }
    return inst.scheduled_for === dayStr;
  }
  if (r.type !== "frequency") return inst.scheduled_for === dayStr;

  // Frequency periods are anchored to scheduled_for and span
  // [scheduled_for, periodEnd). The user has the WHOLE period to hit
  // the goal — so:
  //   - While the period is still open (today < periodEnd) we render the
  //     row on today + every still-future day in the period. Past
  //     intermediate days inside the period drop away ("it displays on
  //     every day until the day passes and it goes away").
  //   - Once the period has closed (today >= periodEnd) and the instance
  //     is STILL pending, the row lands on the period's last day — the
  //     "due day" — as Unlabeled. Earlier days in that closed period
  //     stay empty: marking it Unlabeled on, say, day 1 of a week-long
  //     period would have nagged the user before the rhythm was
  //     actually due.
  const periodEnd = frequencyPeriodEnd(inst.scheduled_for, r);
  const dueDay = frequencyDueDay(inst.scheduled_for, r);
  if (todayStr >= periodEnd) {
    // Period over → only the due day renders the still-pending row.
    return dayStr === dueDay;
  }
  // Period open → today + every future day inside it. Anything strictly
  // before today drops away.
  if (dayStr < inst.scheduled_for) return false;
  if (dayStr < todayStr) return false;
  return dayStr <= dueDay;
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

// ---------------------------------------------------------------------------
// TimelineDayBody — the middle-of-day render used when DayList is in
// timelineMode. Splits the pending `visible` list into TIMED (has
// scheduled_times → hour-grid blocks) and UNTIMED (no time → row list
// below the grid). Everything else in the DaySection (day header,
// Completed/Missed dropdown, InlineAdd row) stays exactly the same as
// the non-timeline variant — click semantics + resolved-in-place +
// InstanceRow behavior are all shared.
// ---------------------------------------------------------------------------

function TimelineDayBody({
  visible,
  resolved,
  onOpenInstance,
  onResolve,
  onUnresolve,
  readOnly,
  tagMap,
  todayStr,
  untimedOpenDefault,
}: {
  visible: DayInstance[];
  resolved: ReadonlyMap<string, "completed" | "missed">;
  onOpenInstance: (inst: DayInstance) => void;
  onResolve: (id: string, status: "completed" | "missed") => void;
  onUnresolve: (id: string) => void;
  readOnly: boolean;
  tagMap: TagMap;
  todayStr: string;
  untimedOpenDefault: boolean;
}) {
  const timeFormat = useTimeFormat();

  // Split by presence of scheduled_times. An activity with N times
  // yields N events on the day (Multi-Daily / frequency rhythms).
  const { events, untimed } = useMemo(() => {
    const events: Array<TimelineEvent<DayInstance>> = [];
    const untimed: DayInstance[] = [];
    for (const inst of visible) {
      const starts = inst.activity.scheduled_times ?? [];
      const ends = inst.activity.scheduled_end_times ?? [];
      if (starts.length === 0) {
        untimed.push(inst);
        continue;
      }
      for (let i = 0; i < starts.length; i++) {
        events.push({
          key: `${inst.id}:${i}`,
          data: inst,
          start: starts[i],
          end: ends[i] ?? "",
        });
      }
    }
    return { events, untimed };
  }, [visible]);

  const layout = useMemo(() => layoutEvents(events), [events]);

  // Timeline mode ALWAYS renders the hour rail + grid — even when
  // there are no timed events — so the user gets a visual signal
  // that the timeline overlay is on. Days with no untimed items
  // just show the empty hour column (matches Week view's behavior).

  return (
    <div className="flex flex-col gap-2">
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
            {events.map((ev) => {
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
              // Prefer the client-side "just resolved" status so a
              // block completed from ActivityModal / InstanceRow's
              // inline button shows the resolved styling instantly.
              const displayStatus = resolved.get(inst.id) ?? inst.status;
              const isDone = displayStatus === "completed";
              const isMissed = displayStatus === "missed";
              const borderClass = isDone
                ? "border-emerald-500"
                : isMissed
                  ? "border-red-500"
                  : "border-zinc-400 dark:border-zinc-600";
              const bgClass =
                slot.col % 2 === 0
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "bg-white dark:bg-zinc-900";
              const name = inst.overrideName ?? inst.activity.name;
              return (
                <button
                  key={ev.key}
                  type="button"
                  onClick={() => onOpenInstance(inst)}
                  title={`${name} · ${formatTimeRange(ev.start, ev.end, timeFormat)}`}
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
                  <div className="truncate">{name}</div>
                  <div className="truncate text-[10px] text-zinc-700 dark:text-zinc-300">
                    {formatTimeRange(ev.start, ev.end, timeFormat)}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

      {/* Untimed pending → collapsible <details>. Default open state
          comes from profiles.default_untimed_open (migration 0037,
          user-configurable via Settings → Appearance). Rows inside
          are the SAME InstanceRow used in non-timeline mode, so
          Complete / Missed / Unlabel / Comment all still work. */}
      {untimed.length > 0 && (
        <details
          className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
          open={untimedOpenDefault}
        >
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
            Untimed ({untimed.length})
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {untimed.map((inst) => (
              <InstanceRow
                key={inst.id}
                instance={inst}
                todayStr={todayStr}
                onOpen={() => onOpenInstance(inst)}
                resolution={resolved.get(inst.id) ?? null}
                onResolve={onResolve}
                onUnresolve={onUnresolve}
                readOnly={readOnly}
                tagMap={tagMap}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TimelineConflictBanners — surfaces today's overlapping timed pairs at
// the top of the scroll container when DayList is in timelineMode.
// Ack persists cross-device via acknowledgeConflict (migration 0036).
// ---------------------------------------------------------------------------

function TimelineConflictBanners({
  todayStr,
  instances,
  acknowledgedPairKeys,
  onOpenInstance,
}: {
  todayStr: string;
  instances: DayInstance[];
  acknowledgedPairKeys: readonly string[];
  onOpenInstance: (inst: DayInstance) => void;
}) {
  const timeFormat = useTimeFormat();
  const [locallyAcked, setLocallyAcked] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const todayEvents = useMemo(() => {
    const events: Array<TimelineEvent<DayInstance>> = [];
    for (const inst of instances) {
      if (inst.scheduled_for !== todayStr) continue;
      const starts = inst.activity.scheduled_times ?? [];
      const ends = inst.activity.scheduled_end_times ?? [];
      for (let i = 0; i < starts.length; i++) {
        events.push({
          key: `${inst.id}:${i}`,
          data: inst,
          start: starts[i],
          end: ends[i] ?? "",
        });
      }
    }
    return events;
  }, [instances, todayStr]);

  const conflicts = useMemo(() => detectConflicts(todayEvents), [todayEvents]);
  const dismissed = useMemo(() => {
    const s = new Set(acknowledgedPairKeys);
    for (const k of locallyAcked) s.add(k);
    return s;
  }, [acknowledgedPairKeys, locallyAcked]);
  const visible = conflicts.filter(
    (c) => !dismissed.has(conflictKey(todayStr, c.a, c.b))
  );

  function ack(c: Conflict<DayInstance>) {
    const key = conflictKey(todayStr, c.a, c.b);
    setLocallyAcked((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    startTransition(async () => {
      await acknowledgeConflict(key);
    });
  }

  if (visible.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {visible.map((c) => {
        const nameA = c.a.data.overrideName ?? c.a.data.activity.name;
        const nameB = c.b.data.overrideName ?? c.b.data.activity.name;
        return (
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
                onClick={() => onOpenInstance(c.a.data)}
                className="underline underline-offset-2"
              >
                {nameA}
              </button>{" "}
              ({formatTimeRange(c.a.start, c.a.end, timeFormat)}) overlaps
              with{" "}
              <button
                type="button"
                onClick={() => onOpenInstance(c.b.data)}
                className="underline underline-offset-2"
              >
                {nameB}
              </button>{" "}
              ({formatTimeRange(c.b.start, c.b.end, timeFormat)}).
            </p>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => ack(c)}
                className="rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Got it
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

