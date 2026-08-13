"use client";

// ---------------------------------------------------------------------------
// CommunityJoinRequests — leadership's Approve / Decline surface on the
// Notifications page for pending requests to join communities they lead.
// Mirrors the in-Settings "Pending requests" list, hoisted so leaders see
// them without opening each community. Uses decide_join_request (0031).
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  decideJoinRequest,
  type IncomingJoinRequest,
} from "@/app/actions/communities";

export function CommunityJoinRequests({
  requests,
}: {
  requests: IncomingJoinRequest[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [handled, setHandled] = useState<Set<string>>(new Set());

  function decide(id: string, approve: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await decideJoinRequest(id, approve);
      if (res && "error" in res) {
        setError(res.error);
        return;
      }
      setHandled((prev) => new Set(prev).add(id));
      router.refresh();
    });
  }

  const visible = requests.filter((r) => !handled.has(r.id));

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Join requests ({visible.length})
      </h2>
      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No pending requests.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((r) => (
            <li
              key={r.id}
              className="flex items-start justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {r.requesterName ?? "Someone"}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  wants to join {r.communityName} · {r.communityKind}
                </p>
                {r.note && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-400">
                    {r.note}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => decide(r.id, false)}
                  disabled={isPending}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Decline
                </button>
                <button
                  type="button"
                  onClick={() => decide(r.id, true)}
                  disabled={isPending}
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Approve
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
