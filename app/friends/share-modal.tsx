"use client";

// ---------------------------------------------------------------------------
// ShareRhythmsButton + ShareModal — the per-friend "Share rhythms" flow on
// the Friends page.
//
// The button opens a modal that lists ALL of the caller's active activities
// with a per-activity "Shared" toggle. When an activity is shared, a
// secondary "Share my progress" toggle appears: ON (default) lets the
// friend see the owner's completion history; OFF shares just the
// template/schedule for them to copy.
//
// Everything here is owner-controlled. Friends can only ever view + copy
// what's shared — never edit it. The modal mutates through the sharing
// server actions (shareActivity / unshareActivity / setShareProgress) with
// optimistic local state so each tap feels instant.
// ---------------------------------------------------------------------------

import { useEffect, useState, useTransition } from "react";

import {
  getShareState,
  setShareProgress,
  shareActivity,
  unshareActivity,
  type ShareableActivity,
} from "@/app/actions/sharing";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

export function ShareRhythmsButton({
  friendId,
  friendName,
}: {
  friendId: string;
  friendName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        Share
      </button>
      {open && (
        <ShareModal
          friendId={friendId}
          friendName={friendName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ShareModal({
  friendId,
  friendName,
  onClose,
}: {
  friendId: string;
  friendName: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ShareableActivity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useBodyScrollLock();

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load the share state for this friend on open.
  useEffect(() => {
    let active = true;
    getShareState(friendId)
      .then((rows) => {
        if (active) setItems(rows);
      })
      .catch((e: unknown) => {
        if (active)
          setError(e instanceof Error ? e.message : "Could not load activities.");
      });
    return () => {
      active = false;
    };
  }, [friendId]);

  // Optimistically flip local state, then fire the server action. On error
  // we surface it and reload the authoritative state.
  function patch(activityId: string, next: Partial<ShareableActivity>) {
    setItems((prev) =>
      prev
        ? prev.map((it) => (it.id === activityId ? { ...it, ...next } : it))
        : prev
    );
  }

  function toggleShared(item: ShareableActivity) {
    const nextShared = !item.shared;
    patch(item.id, { shared: nextShared, shareProgress: true });
    setError(null);
    startTransition(async () => {
      const res = nextShared
        ? await shareActivity(item.id, friendId, true)
        : await unshareActivity(item.id, friendId);
      if ("error" in res) {
        setError(res.error);
        // Roll back to the truth.
        const fresh = await getShareState(friendId);
        setItems(fresh);
      }
    });
  }

  function toggleProgress(item: ShareableActivity) {
    const nextProgress = !item.shareProgress;
    patch(item.id, { shareProgress: nextProgress });
    setError(null);
    startTransition(async () => {
      const res = await setShareProgress(item.id, friendId, nextProgress);
      if ("error" in res) {
        setError(res.error);
        const fresh = await getShareState(friendId);
        setItems(fresh);
      }
    });
  }

  const sharedCount = items?.filter((i) => i.shared).length ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2
              id="share-modal-title"
              className="break-words text-xl font-semibold tracking-tight"
            >
              Share with {friendName}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              {sharedCount} shared · view &amp; copy only
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Shared rhythms are <strong>read-only</strong> for {friendName} —
            they can view and copy them into their own schedule, but never
            edit yours. Turn off <strong>Share my progress</strong> to share
            just the schedule without your completion history.
          </p>

          {error && (
            <p
              role="alert"
              className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}

          {items === null ? (
            <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>
          ) : items.length === 0 ? (
            <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
              You have no active activities to share. Add one first.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-md border border-zinc-200 px-4 py-3 dark:border-zinc-800"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {item.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleShared(item)}
                      role="switch"
                      aria-checked={item.shared}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                        item.shared
                          ? "bg-emerald-500"
                          : "bg-zinc-300 dark:bg-zinc-700"
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                          item.shared ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </div>
                  {item.shared && (
                    <label className="mt-3 flex items-center justify-between gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        Share my progress
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleProgress(item)}
                        role="switch"
                        aria-checked={item.shareProgress}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                          item.shareProgress
                            ? "bg-zinc-900 dark:bg-zinc-50"
                            : "bg-zinc-300 dark:bg-zinc-700"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform dark:bg-zinc-900 ${
                            item.shareProgress
                              ? "translate-x-4"
                              : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            onClick={onClose}
            className="w-full touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
