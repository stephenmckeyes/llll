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

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  getShareState,
  setShareProgress,
  shareActivity,
  unshareActivity,
  type ShareableActivity,
} from "@/app/actions/sharing";
import { rhythmCategoryLabel } from "@/lib/domain/rhythm-summary";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

import { ControlRow, Segmented } from "@/app/_components/segmented";

// Mirrors Total View's GroupBy so the share modal offers the same three
// buckets. Status here shows Active · On grid vs. Active · Off grid
// because the modal only lists active activities (getShareState filters
// archived rows out — you can't share an archive).
type GroupBy = "status" | "tag" | "rhythm";
type ShareGroup = { key: string; label: string; items: ShareableActivity[] };

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
  const [groupBy, setGroupBy] = useState<GroupBy>("tag");
  const [search, setSearch] = useState("");

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

  // Search + group, mirroring TotalView's flow: search filters first
  // (across the full list), then the survivors get bucketed for
  // display.
  const groups = useMemo(() => {
    if (!items) return null;
    const q = search.trim().toLowerCase();
    const filtered = q
      ? items.filter((i) => i.name.toLowerCase().includes(q))
      : items;
    return buildShareGroups(filtered, groupBy);
  }, [items, search, groupBy]);

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
          <p className="mb-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            Shared rhythms are <strong>read-only</strong> for {friendName} —
            they can view and copy them into their own schedule, but never
            edit yours. Turn off <strong>Share my progress</strong> to share
            just the schedule without your completion history.
          </p>

          {/* Filter + grouping controls — same shape Total View uses,
              so users don't have to learn a second pattern. */}
          {items !== null && items.length > 0 && (
            <div className="mb-3 flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <ControlRow label="Search">
                <div className="relative min-w-0 flex-1">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name…"
                    className="w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-1.5 pr-7 text-xs dark:border-zinc-700 dark:bg-zinc-900"
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
              </ControlRow>
              <ControlRow label="Group by">
                <Segmented
                  options={[
                    ["status", "Status"],
                    ["tag", "Tag"],
                    ["rhythm", "Rhythm"],
                  ]}
                  value={groupBy}
                  onChange={(v) => setGroupBy(v as GroupBy)}
                />
              </ControlRow>
            </div>
          )}

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
          ) : groups && groups.length === 0 ? (
            // Search miss.
            <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
              No activities match &ldquo;{search}&rdquo;.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {(groups ?? []).map((g) => (
                <details
                  key={g.key}
                  open
                  className="rounded-md border border-zinc-200 dark:border-zinc-800"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
                      {g.label} ({g.items.length})
                    </span>
                  </summary>
                  <ul className="flex flex-col gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
                    {g.items.map((item) => (
                      <ShareRow
                        key={item.id}
                        item={item}
                        onToggleShared={() => toggleShared(item)}
                        onToggleProgress={() => toggleProgress(item)}
                      />
                    ))}
                  </ul>
                </details>
              ))}
            </div>
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

// ---------------------------------------------------------------------------
// ShareRow — one activity row inside a group. Same visual/toggle set as
// before the refactor; only difference is the surrounding <ul> wraps it in
// a group instead of showing the flat list.
// ---------------------------------------------------------------------------

function ShareRow({
  item,
  onToggleShared,
  onToggleProgress,
}: {
  item: ShareableActivity;
  onToggleShared: () => void;
  onToggleProgress: () => void;
}) {
  return (
    <li className="rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-medium">{item.name}</span>
        <button
          type="button"
          onClick={onToggleShared}
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
        <label className="mt-2 flex items-center justify-between gap-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <span className="text-xs text-zinc-600 dark:text-zinc-400">
            Share my progress
          </span>
          <button
            type="button"
            onClick={onToggleProgress}
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
                item.shareProgress ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </label>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Grouping — parallels total-view.tsx's buildGroups but scoped to
// ShareableActivity (which lacks archived_at because getShareState only
// returns active activities). Sorted alphabetically inside each bucket
// so a search-narrowed list still reads top-to-bottom.
// ---------------------------------------------------------------------------

function buildShareGroups(
  rows: ShareableActivity[],
  groupBy: GroupBy
): ShareGroup[] {
  if (groupBy === "status") {
    const out: ShareGroup[] = [];
    const onGrid = rows.filter((a) => a.trackOnGrid);
    const offGrid = rows.filter((a) => !a.trackOnGrid);
    if (onGrid.length > 0) {
      out.push({
        key: "on-grid",
        label: "On grid",
        items: sortByName(onGrid),
      });
    }
    if (offGrid.length > 0) {
      out.push({
        key: "off-grid",
        label: "Off grid",
        items: sortByName(offGrid),
      });
    }
    return out;
  }

  if (groupBy === "rhythm") {
    return groupBy_(rows, (a) =>
      rhythmCategoryLabel(a.rhythm, a.scheduledTimes)
    );
  }

  // tag — first tag or "No tag" bucket.
  return groupBy_(rows, (a) => a.defaultSkillTags[0] ?? "No tag");
}

function groupBy_(
  rows: ShareableActivity[],
  keyOf: (a: ShareableActivity) => string
): ShareGroup[] {
  const buckets = new Map<string, ShareableActivity[]>();
  for (const a of rows) {
    const k = keyOf(a);
    const arr = buckets.get(k);
    if (arr) arr.push(a);
    else buckets.set(k, [a]);
  }
  return Array.from(buckets.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((k) => ({
      key: k,
      label: k,
      items: sortByName(buckets.get(k) ?? []),
    }));
}

function sortByName(rows: ShareableActivity[]): ShareableActivity[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}
