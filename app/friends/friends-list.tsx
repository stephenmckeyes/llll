"use client";

// ---------------------------------------------------------------------------
// FriendsList — the accepted-friend section of /friends. Adds two things
// the plain server render couldn't do:
//
//   1. Name search — case-insensitive substring across display name +
//      username. Useful once the list crosses ~10 rows.
//   2. Edit-reorder mode — a top-right Edit toggle exposes ▲ / ▼ buttons
//      on every row and hides the noisy per-row action set (Chat / View /
//      Share / Remove) so the reordering is unambiguous. Save posts the
//      new order to reorderFriends; Cancel restores the last-loaded
//      order.
//
// Sorting: rows arrive from getSocialOverview() already sorted by
// (sort_order ASC NULLS LAST, created_at DESC). We preserve that order
// while displaying and, in edit mode, mutate a local copy.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

import {
  reorderFriends,
  type SocialEntry,
} from "@/app/actions/friends";

import { FriendRowButton } from "./friends-client";
import { ShareRhythmsButton } from "./share-modal";

type Props = {
  friends: SocialEntry[];
  /** Per-friend unread-message count for the badge on Chat. */
  unread: Record<string, number>;
};

// Server components can't pass functions into client components (RSC
// only serializes plain data), so the display-label rule lives inside
// this client module. Same shape the /friends page had before.
function nameOf(e: SocialEntry): string {
  return (
    e.otherDisplayName ||
    (e.otherUsername ? `@${e.otherUsername}` : "Someone")
  );
}

export function FriendsList({ friends, unread }: Props) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  // Local copy the user reorders in edit mode. Reset when the server
  // prop changes (fresh page load, reorder save) via a snapshot key.
  const [order, setOrder] = useState<SocialEntry[]>(friends);
  const [snapshotKey, setSnapshotKey] = useState(
    friends.map((f) => f.friendshipId).join(",")
  );
  const nextKey = friends.map((f) => f.friendshipId).join(",");
  if (nextKey !== snapshotKey) {
    setSnapshotKey(nextKey);
    setOrder(friends);
  }
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Search is applied AFTER order so reorder still works on the full
  // list — a search-narrowed view would let the user "move up" a row
  // that has invisible neighbors and produce surprising results.
  const displayed = useMemo(() => {
    if (editing) return order;
    const q = search.trim().toLowerCase();
    if (!q) return order;
    return order.filter((f) => {
      const label = nameOf(f).toLowerCase();
      const uname = (f.otherUsername ?? "").toLowerCase();
      return label.includes(q) || uname.includes(q);
    });
  }, [order, search, editing]);

  function move(index: number, direction: -1 | 1) {
    const next = order.slice();
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= next.length) return;
    [next[index], next[swapWith]] = [next[swapWith], next[index]];
    setOrder(next);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await reorderFriends(order.map((f) => f.friendshipId));
      if ("error" in res) {
        setError(res.error);
      } else {
        setEditing(false);
      }
    });
  }

  function cancel() {
    setOrder(friends);
    setEditing(false);
    setError(null);
  }

  return (
    <>
      {/* Header row: heading + Edit toggle + Search on its own line
          when not editing so the search bar keeps the full width on
          mobile. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Your friends ({friends.length})
        </h2>
        {friends.length > 1 && (
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={cancel}
                  disabled={isPending}
                  className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={isPending}
                  className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  {isPending ? "Saving…" : "Save order"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Edit order
              </button>
            )}
          </div>
        )}
      </div>

      {!editing && friends.length > 0 && (
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search friends by name or @username…"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 pr-8 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              ×
            </button>
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {friends.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No friends yet. Find someone above to get started.
        </p>
      ) : displayed.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No matches for &ldquo;{search}&rdquo;.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {displayed.map((f, i) => (
            <li
              key={f.friendshipId}
              className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{nameOf(f)}</p>
                {f.otherUsername && (
                  <p className="truncate text-xs text-zinc-500">
                    @{f.otherUsername}
                  </p>
                )}
              </div>
              {editing ? (
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={isPending || i === 0}
                    aria-label="Move up"
                    className="rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={isPending || i === order.length - 1}
                    aria-label="Move down"
                    className="rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    ▼
                  </button>
                </div>
              ) : (
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <Link
                    href={`/friends/${f.otherId}/chat`}
                    className="relative inline-flex items-center rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    Chat
                    {(unread[f.otherId] ?? 0) > 0 && (
                      <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                        {unread[f.otherId] > 99 ? "99+" : unread[f.otherId]}
                      </span>
                    )}
                  </Link>
                  <Link
                    href={`/friends/${f.otherId}`}
                    className="inline-flex items-center rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    View
                  </Link>
                  <ShareRhythmsButton
                    friendId={f.otherId}
                    friendName={nameOf(f)}
                  />
                  <FriendRowButton
                    friendshipId={f.friendshipId}
                    label="Remove"
                    confirmText={`Remove ${nameOf(f)} from your friends?`}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
