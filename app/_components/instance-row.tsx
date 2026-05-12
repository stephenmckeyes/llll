"use client";

// ---------------------------------------------------------------------------
// A single activity row inside the Day view list.
//
//   - Whole row is clickable → opens the activity modal (via onOpen prop).
//   - Complete and Missed are quick-action buttons that stop propagation;
//     pressing them runs the server action without opening the modal.
//   - Future-dated Complete prompts a window.confirm (the future-warning
//     setting lives in BACKLOG).
// ---------------------------------------------------------------------------

import { useTransition } from "react";

import {
  completeInstance,
  missInstance,
} from "@/app/actions/activities";

import type { DayInstance } from "./day-list";

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
}: {
  instance: DayInstance;
  todayStr: string;
  onOpen: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const activity = instance.activity;
  const isFrequency = activity.rhythm.type === "frequency";
  const isSingle = activity.rhythm.type === "single";

  const overdueDays =
    isSingle && instance.scheduled_for < todayStr
      ? daysBetween(instance.scheduled_for, todayStr)
      : 0;

  let hint: { text: string; tone: "muted" | "danger" } | null = null;
  if (isFrequency) {
    hint = {
      text: `Goal ${instance.completionCount}/${
        activity.rhythm.type === "frequency" ? activity.rhythm.count : 0
      }`,
      tone: "muted",
    };
  } else if (isSingle) {
    hint =
      overdueDays > 0
        ? { text: `Overdue by ${overdueDays}d`, tone: "danger" }
        : null;
  }

  function handleComplete(e: React.MouseEvent) {
    e.stopPropagation();
    if (instance.scheduled_for > todayStr) {
      const ok = window.confirm(
        `This is scheduled for ${instance.scheduled_for}, in the future. Mark complete anyway?`
      );
      if (!ok) return;
    }
    startTransition(async () => {
      await completeInstance(instance.id);
    });
  }

  function handleMissed(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      await missInstance(instance.id);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={handleKeyDown}
      className="flex w-full min-w-0 cursor-pointer items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white p-3 transition-colors hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 dark:focus:bg-zinc-900 dark:focus-visible:ring-zinc-50"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
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
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          disabled={isPending}
          onClick={handleComplete}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? "…" : isFrequency ? "+1" : "Complete"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={handleMissed}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Missed
        </button>
      </div>
    </div>
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
