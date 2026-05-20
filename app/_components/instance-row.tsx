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

import { useTransition } from "react";

import {
  completeInstance,
  missInstance,
} from "@/app/actions/activities";
import type { TagMap } from "@/lib/domain/tags";

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
  onDispatchOptimistic,
  tagMap,
}: {
  instance: DayInstance;
  todayStr: string;
  onOpen: () => void;
  /**
   * Optimistic-hide callback — fires BEFORE the server action so the
   * row disappears from the list instantly. The parent DayList tracks
   * the set of optimistic IDs and clears them whenever a fresh
   * `instances` prop arrives (server-revalidated truth).
   *
   * Frequency rhythms don't optimistic-hide on a single +1 because the
   * row needs to stay visible until X reaches the target — see
   * handleComplete below.
   */
  onDispatchOptimistic: (id: string) => void;
  /** Name → color lookup for the tag chips below the activity name. */
  tagMap: TagMap;
}) {
  const [isPending, startTransition] = useTransition();
  const activity = instance.activity;
  const isFrequency = activity.rhythm.type === "frequency";
  const isSingle = activity.rhythm.type === "single";

  const overdueDays =
    isSingle && instance.scheduled_for < todayStr
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
  const scheduledTimes = activity.scheduled_times ?? [];
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
  const accumulatingProgress = instance.completionCount;

  // For frequency rhythms the X/Y is shown as a separate badge next to the
  // +1 button (more discoverable). For singles we still surface an overdue
  // banner. Non-frequency, non-overdue rows just show the activity body.
  let hint: { text: string; tone: "muted" | "danger" } | null = null;
  if (isSingle && overdueDays > 0) {
    hint = { text: `Overdue by ${overdueDays}d`, tone: "danger" };
  }

  function handleComplete() {
    if (instance.scheduled_for > todayStr) {
      const ok = window.confirm(
        `This is scheduled for ${instance.scheduled_for}, in the future. Mark complete anyway?`
      );
      if (!ok) return;
    }
    // Optimistic hide only when the click finishes the activity:
    //   - Non-accumulating: one click = done → hide immediately
    //   - Accumulating: only the last +1 (reaching target) hides
    // Hiding mid-accumulation would be confusing.
    if (
      !isAccumulating ||
      accumulatingProgress + 1 >= accumulatingTarget
    ) {
      onDispatchOptimistic(instance.id);
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
    onDispatchOptimistic(instance.id);
    startTransition(async () => {
      await missInstance(instance.id);
    });
  }

  return (
    <li className="flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white p-3 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900">
      {/* Body — clickable area that opens the modal. */}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer touch-manipulation items-start gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-50"
      >
        <span
          aria-hidden
          title={`${PRIORITY_LABEL[activity.priority] ?? "Medium"} priority`}
          className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
            PRIORITY_DOT_CLASS[activity.priority] ?? PRIORITY_DOT_CLASS[2]
          }`}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{activity.name}</p>
          {activity.notes && (
            <p className="truncate text-sm text-zinc-500 dark:text-zinc-500">
              {activity.notes}
            </p>
          )}
          {activity.scheduled_times.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-zinc-600 dark:text-zinc-400">
              {activity.scheduled_times.map(formatTime).join(" · ")}
            </p>
          )}
          {activity.default_skill_tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              <TagChipList
                names={activity.default_skill_tags}
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

      {/* Accumulating progress badge. Shown for frequency rhythms AND
          for any rhythm with multiple scheduled_times — both surface
          a "+1 of N" workflow rather than one-and-done. Click the
          badge to set the count exactly (handy for end-of-day mass-
          fill or undoing an over-click). */}
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

      {/* Complete + Missed as TRUE siblings, not nested. */}
      <button
        type="button"
        disabled={isPending}
        onClick={handleComplete}
        className="shrink-0 touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700 active:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "…" : isAccumulating ? "+1" : "Complete"}
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={handleMissed}
        className="shrink-0 touch-manipulation rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 active:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        Missed
      </button>
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
