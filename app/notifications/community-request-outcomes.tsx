"use client";

// ---------------------------------------------------------------------------
// CommunityRequestOutcomes — tells a requester what happened to the join
// requests they sent (approved / declined), each with a Dismiss that clears
// it from their feed (dismiss_request_outcome, migration 0050).
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  dismissRequestOutcome,
  type RequestOutcome,
} from "@/app/actions/communities";

export function CommunityRequestOutcomes({
  outcomes,
}: {
  outcomes: RequestOutcome[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  function dismiss(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await dismissRequestOutcome(id);
      if (res && "error" in res) {
        setError(res.error);
        return;
      }
      setDismissed((prev) => new Set(prev).add(id));
      router.refresh();
    });
  }

  const visible = outcomes.filter((o) => !dismissed.has(o.id));
  if (visible.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Request updates ({visible.length})
      </h2>
      <ul className="flex flex-col gap-2">
        {visible.map((o) => {
          const approved = o.status === "approved";
          return (
            <li
              key={o.id}
              className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {o.communityName}
                </p>
                <p
                  className={`truncate text-xs ${
                    approved
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-zinc-500"
                  }`}
                >
                  Your request to join was{" "}
                  {approved ? "approved 🎉" : "declined"} · {o.communityKind}
                </p>
              </div>
              <button
                type="button"
                onClick={() => dismiss(o.id)}
                disabled={isPending}
                className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Dismiss
              </button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
