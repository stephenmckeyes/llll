"use client";

// ---------------------------------------------------------------------------
// FriendActivityNotifications — the "Friend activity" section on
// /notifications. Renders the live watch-reminder notes, each linking to the
// friend's grid with that activity highlighted. Per-item Clear, checkbox
// select + Clear selected, and Clear all; dismissals persist in localStorage
// so cleared notes don't reappear (new ones do, since their id changes).
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useState } from "react";

import type { FriendNote } from "./friend-activity";

const LS_KEY = "mission-cleared-watch-notes";

function loadCleared(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr)
      ? new Set(arr.filter((x): x is string => typeof x === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function saveCleared(s: Set<string>) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(Array.from(s)));
  } catch {
    // best-effort
  }
}

export function FriendActivityNotifications({ notes }: { notes: FriendNote[] }) {
  const [cleared, setCleared] = useState<Set<string>>(() => loadCleared());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visible = notes.filter((n) => !cleared.has(n.id));

  function clearIds(ids: Iterable<string>) {
    setCleared((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      saveCleared(next);
      return next;
    });
    setSelected(new Set());
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Friend activity ({visible.length})
        </h2>
        {visible.length > 0 && (
          <div className="flex shrink-0 gap-2">
            {selected.size > 0 && (
              <button
                type="button"
                onClick={() => clearIds(selected)}
                className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Clear selected ({selected.size})
              </button>
            )}
            <button
              type="button"
              onClick={() => clearIds(visible.map((n) => n.id))}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No friend-activity reminders. Open a friend&rsquo;s shared rhythm and
          tap <span className="font-medium">Reminders</span> to start watching.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((n) => (
            <li
              key={n.id}
              className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <input
                type="checkbox"
                checked={selected.has(n.id)}
                onChange={() => toggleSelect(n.id)}
                aria-label="Select notification"
                className="h-4 w-4 shrink-0"
              />
              <Link
                href={`/friends/${n.ownerId}?view=grid&highlight=${n.activityId}`}
                className="min-w-0 flex-1"
              >
                <p className="text-sm">{n.message}</p>
                <p className="truncate text-xs text-zinc-500">
                  Tap to view in their grid
                </p>
              </Link>
              <button
                type="button"
                onClick={() => clearIds([n.id])}
                aria-label="Clear"
                className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
              >
                <span className="text-lg leading-none">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
