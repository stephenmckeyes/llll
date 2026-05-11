"use client";

// ---------------------------------------------------------------------------
// One row on the day list.
//
//   - Complete (or +1 for frequency rhythms) is the primary quick-action.
//   - Edit opens an actions panel below the row with:
//       Complete · Skip · Edit Activity · Edit Rhythm · Archive
//     Permanent deletion is intentionally NOT here — to delete for good,
//     you go to Manage → Archived → Delete.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  archiveActivity,
  completeInstance,
  skipInstance,
} from "@/app/actions/activities";

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
  const [showActions, setShowActions] = useState(false);

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

  function run(action: () => Promise<unknown>) {
    startTransition(async () => {
      await action();
      setShowActions(false);
    });
  }

  return (
    <li className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex min-w-0 items-center justify-between gap-3 p-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            aria-hidden
            title={`${PRIORITY_LABEL[priority] ?? "Medium"} priority`}
            className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${
              PRIORITY_DOT_CLASS[priority] ?? PRIORITY_DOT_CLASS[2]
            }`}
          />
          <div className="min-w-0">
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
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => completeInstance(instanceId))}
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? "…" : isFrequency ? "+1" : "Complete"}
          </button>
          <button
            type="button"
            onClick={() => setShowActions((v) => !v)}
            aria-label={showActions ? "Hide options" : "Show options"}
            className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Edit
          </button>
        </div>
      </div>

      {showActions && (
        <div className="grid grid-cols-2 gap-1 border-t border-zinc-200 bg-zinc-50 p-2 sm:grid-cols-3 dark:border-zinc-800 dark:bg-zinc-950">
          <ActionButton
            label="Complete"
            disabled={isPending}
            onClick={() => run(() => completeInstance(instanceId))}
          />
          <ActionButton
            label="Skip"
            disabled={isPending}
            onClick={() => run(() => skipInstance(instanceId))}
          />
          <ActionLink
            label="Edit activity"
            href={`/activities/${activityId}/edit?section=activity`}
          />
          <ActionLink
            label="Edit rhythm"
            href={`/activities/${activityId}/edit?section=rhythm`}
          />
          <ActionButton
            label="Archive"
            disabled={isPending}
            onClick={() => run(() => archiveActivity(activityId))}
            tone="danger"
          />
        </div>
      )}
    </li>
  );
}

function ActionButton({
  label,
  disabled,
  onClick,
  tone = "default",
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        tone === "danger"
          ? "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      }`}
    >
      {label}
    </button>
  );
}

function ActionLink({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-zinc-300 px-2 py-1.5 text-center text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
    >
      {label}
    </Link>
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
