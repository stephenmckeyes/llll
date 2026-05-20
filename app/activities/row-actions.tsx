"use client";

// ---------------------------------------------------------------------------
// Per-row actions in the /activities Archive list.
//
//   Active row:   Archive
//   Archived row: Unarchive (opens UnarchiveModal) | Delete (PERMANENT)
//
// Permanent delete only lives here, by design: any active activity must
// be archived before it can be deleted, so destructive action requires
// the user to leave the calendar surfaces first.
//
// Unarchive is NOT a one-click flip anymore. Per user spec it opens an
// edit modal with `start_date` blank, and offers two outcomes — recover
// this row, or create a fresh activity from the edits (keeping the
// archived copy as a template). UnarchiveModal owns that flow.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import type { TagMap } from "@/lib/domain/tags";
import {
  archiveActivity,
  deleteActivity,
} from "@/app/actions/activities";
import type { ActivityFormInitial } from "@/app/_components/activity-form-fields";

import { UnarchiveModal } from "./unarchive-modal";

export function ActivityRowActions({
  activity,
  tagMap,
  archived,
}: {
  /** Full activity data needed by UnarchiveModal when the user clicks
   *  Unarchive. For active rows we only use `.id`. */
  activity: ActivityFormInitial & { id: string };
  tagMap: TagMap;
  archived: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [unarchiveOpen, setUnarchiveOpen] = useState(false);

  return (
    <>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (archived) {
              setUnarchiveOpen(true);
              return;
            }
            startTransition(async () => {
              await archiveActivity(activity.id);
            });
          }}
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
                await deleteActivity(activity.id);
              });
            }}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          >
            Delete
          </button>
        )}
      </div>

      {unarchiveOpen && (
        <UnarchiveModal
          activity={activity}
          tagMap={tagMap}
          onClose={() => setUnarchiveOpen(false)}
        />
      )}
    </>
  );
}
