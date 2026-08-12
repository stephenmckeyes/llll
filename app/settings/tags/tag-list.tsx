"use client";

// ---------------------------------------------------------------------------
// TagList — the /settings/tags interactive table.
//
// Per row: the tag name (dot-colored), a "used by N activities" hint,
// and a Delete button. Delete opens an inline confirm (no modal) that
// spells out the cascade: "This will remove the tag from N activities
// and their completion history."
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import { deleteTag } from "@/app/actions/tags";
import { isValidTagColor, tagChipClasses, type TagInfo } from "@/lib/domain/tags";

type Tag = {
  id: string;
  name: string;
  color: string;
  usageCount: number;
};

// tagChipClasses requires a validated color union. Any legacy tag row
// with a color name that isn't in the current palette falls back to
// gray so the chip still renders.
function safeColor(color: string): TagInfo["color"] {
  return (isValidTagColor(color) ? color : "gray") as TagInfo["color"];
}

export function TagList({ tags: initialTags }: { tags: Tag[] }) {
  const [tags, setTags] = useState<Tag[]>(initialTags);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (tags.length === 0) {
    return (
      <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        No tags yet. Add one by tagging any activity, then it&rsquo;ll
        appear here.
      </p>
    );
  }

  const doDelete = (tag: Tag) => {
    setError(null);
    setFlash(null);
    setPendingId(tag.id);
    startTransition(async () => {
      const res = await deleteTag(tag.id);
      setPendingId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setTags((prev) => prev.filter((t) => t.id !== tag.id));
      setConfirmingId(null);
      setFlash(
        `Deleted “${tag.name}” — removed from ${res.removedFromActivities} activit${
          res.removedFromActivities === 1 ? "y" : "ies"
        } and ${res.removedFromInstances} history row${
          res.removedFromInstances === 1 ? "" : "s"
        }.`
      );
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {flash && (
        <p
          role="status"
          className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
        >
          {flash}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {tags.map((t) => {
          const isConfirming = confirmingId === t.id;
          const isPending = pendingId === t.id;
          return (
            <li key={t.id} className="flex flex-col gap-2 px-3 py-2">
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${tagChipClasses(safeColor(t.color))}`}
                >
                  {t.name}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {t.usageCount === 0
                    ? "unused"
                    : `used by ${t.usageCount} activit${t.usageCount === 1 ? "y" : "ies"}`}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {!isConfirming && (
                    <button
                      type="button"
                      onClick={() => setConfirmingId(t.id)}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              {isConfirming && (
                <div className="flex flex-col gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                  <p>
                    Remove <strong>{t.name}</strong> from{" "}
                    {t.usageCount === 0
                      ? "your tag list"
                      : `${t.usageCount} activit${t.usageCount === 1 ? "y" : "ies"} and every past completion that references it`}
                    ? This can&rsquo;t be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => doDelete(t)}
                      className="rounded-md border border-red-500 bg-red-500 px-2 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-60 dark:border-red-400 dark:bg-red-500 dark:hover:bg-red-400"
                    >
                      {isPending ? "Deleting…" : "Yes, delete"}
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => setConfirmingId(null)}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
