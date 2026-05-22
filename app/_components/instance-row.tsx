"use client";

// ---------------------------------------------------------------------------
// A single activity row inside the Day view list.
//
// The row is **three sibling <button>s** (not a clickable div with nested
// buttons). On iOS Safari, a nested-button structure with stopPropagation
// has been flaky — taps on Complete/Missed sometimes did nothing or
// double-fired. Three siblings sidestep that entirely: each button has its
// own onClick, no event-bubbling games required.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import {
  completeInstance,
  missInstance,
  unlabelInstance,
} from "@/app/actions/activities";
import { rhythmCategoryLabel } from "@/lib/domain/rhythm-summary";
import type { TagMap } from "@/lib/domain/tags";
import { dispatchInstanceResolved } from "@/lib/ui/instance-resolved-event";

import type { DayInstance } from "./day-list";
import { EditableProgressBadge } from "./editable-progress-badge";
import { TagChipList } from "./tag-chip";

const FREQUENCY_BADGE_CLASSES =
  "shrink-0 touch-manipulation rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-700 hover:bg-zinc-100 active:bg-zinc-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800";

const PRIORITY_LABEL: Record<number, string> = {
  1: "High",
  2: "Medium",
  3: "Low",
};

const PRIORITY_DOT_CLASS: Record<number, string> = {
  1: "bg-red-500",
  2: "bg-amber-500",
  3: "bg-zinc-400",
};

export function InstanceRow({
  instance,
  todayStr,
  onOpen,
  onResolve,
  onUnresolve,
  resolution,
  tagMap,
}: {
  instance: DayInstance;
  todayStr: string;
  onOpen: () => void;
  /**
   * Mark-in-place callback. Fires when the user completes or misses
   * this occurrence. The parent (DayList) records the resolution and
   * keeps the row in its SLOT (dimmed, with a status pill) rather than
   * removing it — so rapid down-the-list tapping doesn't reflow the
   * list out from under the user's finger. Resolved rows clear on the
   * next real navigation/refresh.
   *
   * Accumulating (+1) rows only "resolve" on the FINAL +1 that reaches
   * the target; earlier +1s just bump the count in place.
   */
  onResolve: (id: string, status: "completed" | "missed") => void;
  /**
   * Revert callback. Fires when the user taps "Unlabel" on a row they
   * just resolved in place — clears the parent's resolution so the row
   * returns to its actionable (Complete / Missed) state. Pairs with the
   * unlabelInstance server action below, which removes the completion(s)
   * and sets the instance back to pending server-side.
   */
  onUnresolve: (id: string) => void;
  /** This occurrence's current resolution (null = still actionable). */
  resolution: "completed" | "missed" | null;
  /** Name → color lookup for the tag chips below the activity name. */
  tagMap: TagMap;
}) {
  // We keep startTransition (marks the server-action call as a
  // non-blocking transition) but no longer read isPending — the buttons
  // are NOT disabled while the action is in flight, so rapid taps (e.g.
  // +1 +1 +1) all register instead of being eaten by a disabled state.
  const [, startTransition] = useTransition();
  const activity = instance.activity;
  const isFrequency = activity.rhythm.type === "frequency";
  const scheduledTimes = activity.scheduled_times ?? [];

  // Effective per-occurrence values: an "Edit activity" override on THIS
  // instance wins; otherwise inherit the series (activity) value.
  const effectiveName = instance.overrideName ?? activity.name;
  const effectiveNotes = instance.overrideNotes ?? activity.notes;
  const effectivePriority = instance.overridePriority ?? activity.priority;

  // Friendly category text ("Once", "Daily", "Mon · Wed · Fri", etc.)
  // shown right above the activity name so the user sees what kind of
  // rhythm produced this row without opening the modal.
  const rhythmCategory = rhythmCategoryLabel(
    activity.rhythm,
    scheduledTimes
  );

  const overdueDays =
    instance.scheduled_for < todayStr
      ? daysBetween(instance.scheduled_for, todayStr)
      : 0;

  // "Accumulating" mode = +1 button + editable X/Y progress badge,
  // and a single instance only flips to "completed" once N
  // completions are logged. Fires for:
  //   - frequency rhythms (count comes from rhythm.count)
  //   - ANY rhythm with multiple scheduled_times — multi-time daily,
  //     multi-time weekdays, "do it 3 times today" Once events,
  //     etc. Target = scheduled_times.length.
  // This matches the user's expectation that a multi-times task
  // shouldn't be done after one click.
  const isMultiTime = scheduledTimes.length > 1;
  const isAccumulating = isFrequency || isMultiTime;
  // TS can't narrow rhythm.count from `isFrequency` (boolean) alone,
  // so re-check inline. For non-frequency multi-time activities the
  // target is just the number of scheduled times.
  const accumulatingTarget =
    activity.rhythm.type === "frequency"
      ? activity.rhythm.count
      : isMultiTime
        ? scheduledTimes.length
        : 0;
  // Optimistic completion count for accumulating (+1) rows. Each +1 tap
  // bumps this immediately so the X/Y badge reflects the tap WITHOUT a
  // server round-trip (completeInstance no longer revalidates the page).
  // Resets to 0 whenever the server sends a fresh completionCount — the
  // snapshot pattern (React 19 lints the equivalent useEffect form).
  const [optimisticDelta, setOptimisticDelta] = useState(0);
  const [lastServerCount, setLastServerCount] = useState(
    instance.completionCount
  );
  if (lastServerCount !== instance.completionCount) {
    setLastServerCount(instance.completionCount);
    setOptimisticDelta(0);
  }
  const accumulatingProgress = instance.completionCount + optimisticDelta;

  // Past-due-pending = "Unlabeled" warning, shown for EVERY rhythm
  // type (per user spec). Previously only "Once" (single) rhythms
  // got an overdue banner; daily/weekly/interval/frequency rows now
  // surface the same warning when a scheduled occurrence has slipped
  // past today without a verdict.
  let hint: { text: string; tone: "muted" | "danger" } | null = null;
  if (overdueDays > 0) {
    hint = {
      text:
        overdueDays === 1
          ? "Unlabeled — 1 day ago"
          : `Unlabeled — ${overdueDays} days ago`,
      tone: "danger",
    };
  }

  // True when THIS instance counts as "Unlabeled" right now — past-due
  // pending. Drives the optimistic Unlabeled-chip decrement: only
  // resolving an actually-unlabeled instance should drop the chip.
  // For multi-time / frequency rows we only count the FINAL +1 as a
  // resolution (the count flipping to completed); intermediate +1s
  // don't change the chip.
  const isCurrentlyUnlabeled = instance.scheduled_for < todayStr;

  function handleComplete() {
    if (instance.scheduled_for > todayStr) {
      const ok = window.confirm(
        `This is scheduled for ${instance.scheduled_for}, in the future. Mark complete anyway?`
      );
      if (!ok) return;
    }
    // Optimistic feedback fires INSTANTLY, before the server call:
    //   - Non-accumulating: one click = done → mark the row resolved
    //     in place (it stays in its slot, dimmed, so the list doesn't
    //     reflow under rapid tapping).
    //   - Accumulating, last +1 (reaching target): mark resolved.
    //   - Accumulating, mid-progress +1: bump the local count so the
    //     X/Y badge ticks up right away (no server round-trip wait).
    const willFinish =
      !isAccumulating ||
      accumulatingProgress + 1 >= accumulatingTarget;
    if (willFinish) {
      onResolve(instance.id, "completed");
      // Drop the Unlabeled chip immediately when an actually-unlabeled
      // instance gets resolved. Skipped for mid-accumulation +1s and
      // future-scheduled rows (those weren't unlabeled to begin with).
      if (isCurrentlyUnlabeled) {
        dispatchInstanceResolved({ wasUnlabeled: true });
      }
    } else {
      setOptimisticDelta((d) => d + 1);
    }
    startTransition(async () => {
      await completeInstance(instance.id);
    });
  }

  function handleMissed() {
    if (instance.scheduled_for > todayStr) {
      const ok = window.confirm(
        `This is scheduled for ${instance.scheduled_for}, in the future. Mark missed anyway?`
      );
      if (!ok) return;
    }
    onResolve(instance.id, "missed");
    if (isCurrentlyUnlabeled) {
      dispatchInstanceResolved({ wasUnlabeled: true });
    }
    startTransition(async () => {
      await missInstance(instance.id);
    });
  }

  // Revert an accidental Complete/Missed without reloading the page.
  // Returns the row to its actionable state instantly, clears any
  // optimistic +1 progress (unlabelInstance wipes every logged
  // completion server-side), and — if this occurrence was past-due —
  // restores the "Unlabeled" chip the resolve had dropped.
  function handleUnlabel() {
    onUnresolve(instance.id);
    setOptimisticDelta(-instance.completionCount);
    if (isCurrentlyUnlabeled) {
      dispatchInstanceResolved({ wasUnlabeled: true, delta: 1 });
    }
    startTransition(async () => {
      await unlabelInstance(instance.id);
    });
  }

  return (
    <li
      className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white p-3 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 ${
        resolution ? "opacity-60" : ""
      }`}
    >
      {/* Body — clickable area that opens the modal. */}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer touch-manipulation items-start gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-50"
      >
        <span
          aria-hidden
          title={`${PRIORITY_LABEL[effectivePriority] ?? "Medium"} priority`}
          className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
            PRIORITY_DOT_CLASS[effectivePriority] ?? PRIORITY_DOT_CLASS[2]
          }`}
        />
        <div className="min-w-0 flex-1">
          {/* Rhythm-type lozenge sits ABOVE the name as small caps so
              the user sees what kind of activity this is at a glance
              without opening the modal. e.g. "Daily", "Once",
              "Every 3 days", "3x per week". */}
          <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {rhythmCategory}
          </p>
          <p className="truncate font-medium">{effectiveName}</p>
          {effectiveNotes && (
            <p className="truncate text-sm text-zinc-500 dark:text-zinc-500">
              {effectiveNotes}
            </p>
          )}
          {activity.scheduled_times.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-400">
              {activity.scheduled_times.map(formatTime).join(" · ")}
            </p>
          )}
          {instance.tags.length > 0 && (
            // Per-instance tag snapshot — frozen at generation time.
            // Editing the activity's tags via Edit Activity won't
            // change what's drawn here.
            <div className="mt-1 flex flex-wrap gap-1">
              <TagChipList
                names={instance.tags}
                tags={tagMap}
                size="xs"
              />
            </div>
          )}
          {hint && (
            <p
              className={`mt-0.5 text-xs font-medium uppercase tracking-wide ${
                hint.tone === "danger"
                  ? "text-red-600 dark:text-red-400"
                  : "text-zinc-500"
              }`}
            >
              {hint.text}
            </p>
          )}
        </div>
      </button>

      {resolution ? (
        // Resolved IN PLACE — the row keeps its slot so the list doesn't
        // reflow under rapid tapping. A status pill replaces the action
        // buttons, alongside an "Unlabel" button so an accidental tap can
        // be reverted to pending without reloading the page. The row
        // otherwise clears on the next navigation/refresh.
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`min-h-11 inline-flex items-center rounded-md px-3 py-2 text-xs font-semibold ${
              resolution === "completed"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
            }`}
          >
            {resolution === "completed" ? "✓ Done" : "✗ Missed"}
          </span>
          <button
            type="button"
            onClick={handleUnlabel}
            title="Tapped by accident? Revert to pending."
            className="min-h-11 shrink-0 touch-manipulation rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 active:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Unlabel
          </button>
        </div>
      ) : (
        <>
          {/* Accumulating progress badge. Shown for frequency rhythms
              AND for any rhythm with multiple scheduled_times — both
              surface a "+1 of N" workflow rather than one-and-done.
              Click the badge to set the count exactly. */}
          {isAccumulating && (
            <EditableProgressBadge
              instanceId={instance.id}
              current={accumulatingProgress}
              target={accumulatingTarget}
              scheduledFor={instance.scheduled_for}
              todayStr={todayStr}
              className={FREQUENCY_BADGE_CLASSES}
            />
          )}

          {/* Complete + Missed as TRUE siblings, not nested. NOT
              disabled while pending: the row marks done in place the
              instant you tap (or the +1 count bumps), so there's no need
              to lock the button — and locking it was eating rapid taps.
              min-h-11 = 44px tap target. */}
          <button
            type="button"
            onClick={handleComplete}
            className="min-h-11 shrink-0 touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 active:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isAccumulating ? "+1" : "Complete"}
          </button>
          <button
            type="button"
            onClick={handleMissed}
            className="min-h-11 shrink-0 touch-manipulation rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 active:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Missed
          </button>
        </>
      )}
    </li>
  );
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000);
}
