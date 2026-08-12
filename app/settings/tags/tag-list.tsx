"use client";

// ---------------------------------------------------------------------------
// TagList — active + archived tag management on /settings/tags.
//
// Active rows get an "Archive" button. Archiving hides the tag from
// pickers + filters (no data touched on activities / instances). Row
// moves to the Archived section optimistically.
//
// Archived rows get a "Restore" button that puts the tag back into
// pickers + filters.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import { archiveTag, unarchiveTag } from "@/app/actions/tags";
import { isValidTagColor, tagChipClasses, type TagInfo } from "@/lib/domain/tags";

type Tag = {
  id: string;
  name: string;
  color: string;
  usageCount: number;
};

function safeColor(color: string): TagInfo["color"] {
  return (isValidTagColor(color) ? color : "gray") as TagInfo["color"];
}

export function TagList({
  activeTags: initialActive,
  archivedTags: initialArchived,
}: {
  activeTags: Tag[];
  archivedTags: Tag[];
}) {
  const [active, setActive] = useState<Tag[]>(initialActive);
  const [archived, setArchived] = useState<Tag[]>(initialArchived);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const doArchive = (t: Tag) => {
    setError(null);
    setPendingId(t.id);
    startTransition(async () => {
      const res = await archiveTag(t.id);
      setPendingId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setActive((prev) => prev.filter((r) => r.id !== t.id));
      setArchived((prev) =>
        [...prev, { ...t, usageCount: 0 }].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
    });
  };

  const doRestore = (t: Tag) => {
    setError(null);
    setPendingId(t.id);
    startTransition(async () => {
      const res = await unarchiveTag(t.id);
      setPendingId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setArchived((prev) => prev.filter((r) => r.id !== t.id));
      setActive((prev) =>
        [...prev, t].sort((a, b) => a.name.localeCompare(b.name))
      );
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {/* --- Active tags --------------------------------------------- */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Active ({active.length})
        </h2>
        {active.length === 0 ? (
          <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-4 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            No active tags. Add one by tagging any activity, then it&rsquo;ll
            appear here.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {active.map((t) => {
              const isPending = pendingId === t.id;
              return (
                <li
                  key={t.id}
                  className="flex items-center gap-3 px-3 py-2"
                >
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
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => doArchive(t)}
                    title="Hide from picker + filters. Existing references stay."
                    className="ml-auto rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    {isPending ? "Archiving…" : "Archive"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* --- Archived tags ------------------------------------------- */}
      {archived.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Archived ({archived.length})
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Hidden from the picker and every filter. Existing activities
            and completions keep the tag; restore to make it selectable
            again.
          </p>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {archived.map((t) => {
              const isPending = pendingId === t.id;
              return (
                <li
                  key={t.id}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium opacity-60 ${tagChipClasses(safeColor(t.color))}`}
                  >
                    {t.name}
                  </span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => doRestore(t)}
                    className="ml-auto rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  >
                    {isPending ? "Restoring…" : "Restore"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
