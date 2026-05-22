"use client";

// ---------------------------------------------------------------------------
// Client interactions for the Friends page: lookup-and-add search, plus
// per-row remove/cancel buttons. All the heavy lifting is in the friends
// server actions; these components just drive them with instant pending
// states.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import {
  removeFriend,
  respondToRequest,
  searchUser,
  sendFriendRequest,
  type FoundUser,
} from "@/app/actions/friends";

const inputClasses =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50";

function labelFor(u: FoundUser): string {
  return u.displayName || u.username || "Someone";
}

// ---------------------------------------------------------------------------

type SearchResult =
  | { kind: "idle" }
  | { kind: "notfound" }
  | { kind: "error"; message: string }
  | {
      kind: "found";
      user: FoundUser;
      relationship: "none" | "friends" | "outgoing" | "incoming" | "declined";
      friendshipId: string | null;
    };

export function FriendSearch() {
  const [handle, setHandle] = useState("");
  const [result, setResult] = useState<SearchResult>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function doSearch() {
    const q = handle.trim();
    if (!q) return;
    startTransition(async () => {
      const res = await searchUser(q);
      if ("error" in res) setResult({ kind: "error", message: res.error });
      else if (res.user === null) setResult({ kind: "notfound" });
      else
        setResult({
          kind: "found",
          user: res.user,
          relationship: res.relationship,
          friendshipId: res.friendshipId,
        });
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              doSearch();
            }
          }}
          placeholder="Username or email"
          className={inputClasses}
        />
        <button
          type="button"
          onClick={doSearch}
          disabled={isPending}
          className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? "…" : "Search"}
        </button>
      </div>

      {result.kind === "notfound" && (
        <p className="text-sm text-zinc-500">
          No one found with that username or email.
        </p>
      )}
      {result.kind === "error" && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {result.message}
        </p>
      )}
      {result.kind === "found" && (
        <SearchHit
          result={result}
          onChanged={() => setResult({ kind: "idle" })}
        />
      )}
    </div>
  );
}

function SearchHit({
  result,
  onChanged,
}: {
  result: Extract<SearchResult, { kind: "found" }>;
  onChanged: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const { user, relationship, friendshipId } = result;

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{labelFor(user)}</p>
        {user.username && (
          <p className="truncate text-xs text-zinc-500">@{user.username}</p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        {relationship === "friends" && (
          <span className="rounded-md bg-emerald-100 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            Friends ✓
          </span>
        )}
        {relationship === "outgoing" && (
          <span className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            Request sent
          </span>
        )}
        {relationship === "incoming" && friendshipId && (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  await respondToRequest(friendshipId, true);
                  onChanged();
                })
              }
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
            >
              Accept
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  await respondToRequest(friendshipId, false);
                  onChanged();
                })
              }
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Decline
            </button>
          </>
        )}
        {(relationship === "none" || relationship === "declined") && (
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await sendFriendRequest(user.id);
                onChanged();
              })
            }
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
          >
            Add friend
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function FriendRowButton({
  friendshipId,
  label,
  confirmText,
}: {
  friendshipId: string;
  label: string;
  confirmText?: string;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (confirmText && !window.confirm(confirmText)) return;
        startTransition(async () => {
          await removeFriend(friendshipId);
        });
      }}
      className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
    >
      {isPending ? "…" : label}
    </button>
  );
}
