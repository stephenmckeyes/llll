"use client";

// ---------------------------------------------------------------------------
// One row on the today list. Renders the activity name and a "Complete"
// button that calls the completeInstance server action.
//
// Why client component: the form needs useTransition / disabled-while-pending
// behavior. The action itself runs on the server.
// ---------------------------------------------------------------------------

import { useTransition } from "react";

import { completeInstance } from "@/app/actions/today";

export function InstanceRow({
  instanceId,
  name,
  description,
}: {
  instanceId: string;
  name: string;
  description: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        {description && (
          <p className="truncate text-sm text-zinc-500 dark:text-zinc-500">
            {description}
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
        {isPending ? "Logging…" : "Complete"}
      </button>
    </li>
  );
}
