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
  useTransition,
} from "react";

import { unlabelInstance } from "@/app/actions/activities";
import { type AddActivityDensity } from "@/lib/domain/add-activity-density";
import {
  frequencyDueDay,
  frequencyPeriodEnd,
} from "@/lib/domain/frequency-period";
import { summarizeRhythm } from "@/lib/domain/rhythm-summary";
import type { TagMap } from "@/lib/domain/tags";
import { type Rhythm } from "@/lib/validators/rhythm";

import { ActivityModal } from "./activity-modal";
import { CommentModal } from "./comment-modal";
import { IncompleteButton, type IncompleteInfo } from "./incomplete-button";
import { InlineAddRow } from "./inline-add-row";
import { InstanceRow } from "./instance-row";
import { NewActivityModal } from "./new-activity-modal";

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
  density = "default",
}: {
  initialDate: string;
  completedByDate: Record<string, DayMarkedItem[]>;
  missedByDate: Record<string, DayMarkedItem[]>;
  instances: DayInstance[];
  todayStr: string;
  incompleteInfo: IncompleteInfo;
  tagMap: TagMap;
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
        </div>
      </div>

      {/* Scrollable list.
          `h-[60vh]` (with vh, not svh) is intentional: iOS Safari before
          15.4 doesn't support svh; without an explicit height the container
          grows to its content and the whole page scrolls instead of the
          list — which is what was making rows un-tappable on mobile. */}
      <div
        ref={containerRef}
        // Vertical scroll only. `overflow-x-hidden` clips any sideways
        // overflow and `touch-pan-y` tells the browser to honor only
        // up/down panning gestures — so a slightly-diagonal swipe never
        // scrolls the list left/right.
        className="h-[60vh] min-h-[20rem] touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain pr-2 sm:h-[68vh]"
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
            />
          ))}
        </div>
      </div>

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
              resolution={resolved.get(inst.id) ?? null}
              onResolve={onResolve}
              onUnresolve={onUnresolve}
              readOnly={readOnly}
              tagMap={tagMap}
            />
          ))}
        </div>
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
