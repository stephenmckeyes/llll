"use client";

// ---------------------------------------------------------------------------
// SharedNotifications — the "Shared with you" section on /notifications.
//
// Lists every rhythm a friend has shared with you (newest first). Each is a
// dismissible notification: Clear one (×), tick several and Clear selected,
// or Clear all. Dismissals are remembered in localStorage so cleared items
// don't reappear — a new share from a friend shows up again because its
// share id isn't in the cleared set yet. Tapping an item jumps to that
// friend's read-only view.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useState } from "react";

import type { SharedActivity } from "@/app/actions/sharing";

const LS_KEY = "mission-cleared-shares";

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
    // Quota / privacy mode — best-effort.
  }
}

function ownerName(s: SharedActivity): string {
  return (
    s.ownerDisplayName ||
    (s.ownerUsername ? `@${s.ownerUsername}` : "A friend")
  );
}

export function SharedNotifications({ shares }: { shares: SharedActivity[] }) {
  // Lazy init from localStorage so SSR/first paint matches the stored set.
  const [cleared, setCleared] = useState<Set<string>>(() => loadCleared());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // shares arrive newest-first from get_shared_with_me().
  const visible = shares.filter((s) => !cleared.has(s.shareId));

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
          Shared with you ({visible.length})
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
              onClick={() => clearIds(visible.map((s) => s.shareId))}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No new shares.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((s) => (
            <li
              key={s.shareId}
              className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <input
                type="checkbox"
                checked={selected.has(s.shareId)}
                onChange={() => toggleSelect(s.shareId)}
                aria-label={`Select share of ${s.name}`}
                className="h-4 w-4 shrink-0"
              />
              <Link
                href={`/friends/${s.ownerId}`}
                className="min-w-0 flex-1"
              >
                <p className="truncate text-sm">
                  <span className="font-medium">{ownerName(s)}</span> shared{" "}
                  <span className="font-medium">“{s.name}”</span>
                </p>
                <p className="truncate text-xs text-zinc-500">
                  Tap to view their shared rhythms
                </p>
              </Link>
              <button
                type="button"
                onClick={() => clearIds([s.shareId])}
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
