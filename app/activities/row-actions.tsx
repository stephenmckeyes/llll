"use client";

// ---------------------------------------------------------------------------
// Per-row actions in the /activities Manage list.
//
//   Active row:   Archive
//   Archived row: Unarchive | Delete (PERMANENT — confirms first)
//
// Permanent delete only lives here, by design: any active activity must
// be archived before it can be deleted, so destructive action requires
// the user to leave the calendar surfaces first.
// ---------------------------------------------------------------------------

import { useTransition } from "react";

import {
  archiveActivity,
  deleteActivity,
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
      {archived && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            const ok = window.confirm(
              "Permanently delete this activity AND its entire history? This cannot be undone."
            );
            if (!ok) return;
            startTransition(async () => {
              await deleteActivity(activityId);
            });
          }}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          Delete
        </button>
      )}
    </div>
  );
}
