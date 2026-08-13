"use client";

// ---------------------------------------------------------------------------
// Community invites — the invitee's Accept / Decline surface on the
// Notifications page. Mirrors RequestActions (friend requests) but for
// community_invites (migration 0048). Accepting joins the community.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  respondToInvite,
  type PendingInvite,
} from "@/app/actions/communities";

export function CommunityInvites({ invites }: { invites: PendingInvite[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [handled, setHandled] = useState<Set<string>>(new Set());

  function respond(id: string, accept: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await respondToInvite(id, accept);
      if (res && "error" in res) {
        setError(res.error);
        return;
      }
      setHandled((prev) => new Set(prev).add(id));
      router.refresh();
    });
  }

  const visible = invites.filter((i) => !handled.has(i.id));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Community invites ({visible.length})
      </h2>
      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No pending invites.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((i) => (
            <li
              key={i.id}
              className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {i.communityName}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {i.invitedByName
                    ? `${i.invitedByName} invited you`
                    : "You've been invited"}
                  {" · "}
                  {i.communityKind}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => respond(i.id, false)}
                  disabled={isPending}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Decline
                </button>
                <button
                  type="button"
                  onClick={() => respond(i.id, true)}
                  disabled={isPending}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Accept
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
