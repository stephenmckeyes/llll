"use client";

// ---------------------------------------------------------------------------
// One row on the today list — task variant. Renders due-date hint, priority
// indicator, and a Complete button that goes through logCompletion.
// ---------------------------------------------------------------------------

import { useTransition } from "react";

import { completeTask } from "@/app/actions/tasks";

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

export function TaskRow({
  taskId,
  name,
  description,
  dueDate,
  earliestDate,
  priority,
  todayStr,
}: {
  taskId: string;
  name: string;
  description: string | null;
  dueDate: string | null;
  earliestDate: string | null;
  priority: number;
  todayStr: string;
}) {
  const [isPending, startTransition] = useTransition();

  const dueHint = dueDateHint(dueDate, earliestDate, todayStr);
  const isOverdue = dueDate !== null && dueDate < todayStr;

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden
          title={`${PRIORITY_LABEL[priority]} priority`}
          className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT_CLASS[priority]}`}
        />
        <div className="min-w-0">
          <p className="truncate font-medium">{name}</p>
          {description && (
            <p className="truncate text-sm text-zinc-500 dark:text-zinc-500">
              {description}
            </p>
          )}
          {dueHint && (
            <p
              className={`mt-0.5 text-xs font-medium uppercase tracking-wide ${
                isOverdue
                  ? "text-red-600 dark:text-red-400"
                  : "text-zinc-500"
              }`}
            >
              {dueHint}
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await completeTask(taskId);
          })
        }
        className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Logging…" : "Complete"}
      </button>
    </li>
  );
}

/**
 * Build a short due-date hint: "Due today", "Overdue by 3d",
 * "Due in 4d", "From May 12 to May 18".
 */
function dueDateHint(
  dueDate: string | null,
  earliestDate: string | null,
  todayStr: string
): string | null {
  if (dueDate && earliestDate && dueDate !== earliestDate) {
    return `Window: ${shortDate(earliestDate)} → ${shortDate(dueDate)}`;
  }
  if (!dueDate) {
    if (earliestDate && earliestDate > todayStr) {
      return `Starts ${shortDate(earliestDate)}`;
    }
    return null;
  }

  const diff = daysBetween(todayStr, dueDate);
  if (diff === 0) return "Due today";
  if (diff < 0) return `Overdue by ${Math.abs(diff)}d`;
  if (diff === 1) return "Due tomorrow";
  if (diff <= 30) return `Due in ${diff}d`;
  return `Due ${shortDate(dueDate)}`;
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function shortDate(ymd: string): string {
  const d = parseYmd(ymd);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
