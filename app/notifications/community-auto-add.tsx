"use client";

// ---------------------------------------------------------------------------
// CommunityAutoAdd — tells a member when a new activity was auto-added to
// their schedule (opt-in per community). Each notice has a Dismiss that
// clears it (dismiss_auto_add_event, migration 0055).
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  dismissAutoAddEvent,
  type AutoAddEvent,
} from "@/app/actions/communities";

export function CommunityAutoAdd({ events }: { events: AutoAddEvent[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  function dismiss(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await dismissAutoAddEvent(id);
      if (res && "error" in res) {
        setError(res.error);
        return;
      }
      setDismissed((prev) => new Set(prev).add(id));
      router.refresh();
    });
  }

  const visible = events.filter((e) => !dismissed.has(e.id));
  if (visible.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Added to your calendar ({visible.length})
      </h2>
      <ul className="flex flex-col gap-2">
        {visible.map((e) => (
          <li
            key={e.id}
            className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{e.activityName}</p>
              <p className="truncate text-xs text-zinc-500">
                Auto-added from {e.communityName} · {e.communityKind}
              </p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(e.id)}
              disabled={isPending}
              className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
