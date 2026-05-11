"use client";

// ---------------------------------------------------------------------------
// Per-row Archive / Unarchive button for the activities list.
// Client component because it uses useTransition for the pending state.
// ---------------------------------------------------------------------------

import { useTransition } from "react";

import {
  archiveActivity,
  unarchiveActivity,
} from "@/app/actions/activities";

export function ActivityRowActions({
  activityId,
  archived,
}: {
  activityId: string;
  archived: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex shrink-0 gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            if (archived) await unarchiveActivity(activityId);
            else await archiveActivity(activityId);
          })
        }
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {isPending ? "…" : archived ? "Unarchive" : "Archive"}
      </button>
    </div>
  );
}
