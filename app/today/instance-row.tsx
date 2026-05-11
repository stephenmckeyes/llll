"use client";

// ---------------------------------------------------------------------------
// One row on the day list.
//
//   - The whole row is a click target → navigates to the activity details
//     page (/activities/[id]?instance=...).
//   - The Complete (or "+1" for frequency) button sits on top of the row's
//     link and stops propagation, so clicking it logs the completion
//     without leaving the day list.
//   - When the instance is scheduled in the future, completing prompts a
//     window.confirm first. (Captured in BACKLOG for a future user-setting
//     toggle.)
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useTransition } from "react";

import { completeInstance } from "@/app/actions/activities";

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
  instanceId,
  activityId,
  name,
  notes,
  priority,
  scheduledFor,
  scheduledTimes,
  todayStr,
  isSingle,
  frequencyTarget,
  frequencyProgress,
}: {
  instanceId: string;
  activityId: string;
  name: string;
  notes: string | null;
  priority: number;
  scheduledFor: string;
  scheduledTimes: string[];
  todayStr: string;
  isSingle: boolean;
  frequencyTarget: number | null;
  frequencyProgress: number | null;
}) {
  const [isPending, startTransition] = useTransition();

  const isFrequency = frequencyTarget !== null;
  const overdueDays =
    isSingle && scheduledFor < todayStr ? daysBetween(scheduledFor, todayStr) : 0;

  let hint: { text: string; tone: "muted" | "danger" } | null = null;
  if (isFrequency) {
    hint = {
      text: `Goal ${frequencyProgress}/${frequencyTarget}`,
      tone: "muted",
    };
  } else if (isSingle) {
    hint =
      overdueDays > 0
        ? { text: `Overdue by ${overdueDays}d`, tone: "danger" }
        : { text: "Due today", tone: "muted" };
  }

  function handleComplete() {
    if (scheduledFor > todayStr) {
      const ok = window.confirm(
        `This is scheduled for ${scheduledFor}, in the future. Mark complete anyway?`
      );
      if (!ok) return;
    }
    startTransition(async () => {
      await completeInstance(instanceId);
    });
  }

  const detailsHref = `/activities/${activityId}?instance=${instanceId}`;

  return (
    <li className="relative">
      {/* Whole-row click target — sits behind the Complete button. */}
      <Link
        href={detailsHref}
        className="block min-w-0 rounded-md border border-zinc-200 bg-white p-3 pr-24 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            title={`${PRIORITY_LABEL[priority] ?? "Medium"} priority`}
            className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
              PRIORITY_DOT_CLASS[priority] ?? PRIORITY_DOT_CLASS[2]
            }`}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{name}</p>
            {notes && (
              <p className="truncate text-sm text-zinc-500 dark:text-zinc-500">
                {notes}
              </p>
            )}
            {scheduledTimes.length > 0 && (
              <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
                {scheduledTimes.map(formatTime).join(" · ")}
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
      </Link>

      {/* Complete button — absolutely positioned over the row's right
          edge. stopPropagation so its click doesn't bubble to the Link. */}
      <button
        type="button"
        disabled={isPending}
        onClick={(e) => {
          e.stopPropagation();
          handleComplete();
        }}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "…" : isFrequency ? "+1" : "Complete"}
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
