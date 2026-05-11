"use client";

// ---------------------------------------------------------------------------
// One row on the today list.
//
//   - Non-frequency rhythms: a single "Complete" button.
//   - Frequency rhythms: "Goal X/N" progress + "+1" button. The instance
//     auto-completes (and leaves the list) once X reaches N.
// ---------------------------------------------------------------------------

import { useTransition } from "react";

import { completeInstance } from "@/app/actions/today";

export function InstanceRow({
  instanceId,
  name,
  description,
  frequencyTarget,
  frequencyProgress,
}: {
  instanceId: string;
  name: string;
  description: string | null;
  /** null for non-frequency rhythms. */
  frequencyTarget: number | null;
  /** null for non-frequency rhythms. */
  frequencyProgress: number | null;
}) {
  const [isPending, startTransition] = useTransition();
  const isFrequency = frequencyTarget !== null;

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        {description && (
          <p className="truncate text-sm text-zinc-500 dark:text-zinc-500">
            {description}
          </p>
        )}
        {isFrequency && (
          <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Goal {frequencyProgress}/{frequencyTarget}
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await completeInstance(instanceId);
          })
        }
        className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Logging…" : isFrequency ? "+1" : "Complete"}
      </button>
    </li>
  );
}
