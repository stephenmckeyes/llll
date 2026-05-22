"use client";

// ---------------------------------------------------------------------------
// Accept / Decline buttons for an incoming friend request, shown on the
// Notifications page. Wraps respondToRequest with an instant pending state.
// ---------------------------------------------------------------------------

import { useTransition } from "react";

import { respondToRequest } from "@/app/actions/friends";

export function RequestActions({ friendshipId }: { friendshipId: string }) {
  const [isPending, startTransition] = useTransition();
  return (
    <div className="flex shrink-0 gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await respondToRequest(friendshipId, true);
          })
        }
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "…" : "Accept"}
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await respondToRequest(friendshipId, false);
          })
        }
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Decline
      </button>
    </div>
  );
}
