"use client";

// ---------------------------------------------------------------------------
// SharedList — client renderer for the /shared page. Lists the rhythms
// friends have shared with you and opens the CopyShareModal so you can copy
// any of them into your own schedule. Read-only: there's no way to edit the
// owner's activity from here, by design.
// ---------------------------------------------------------------------------

import { useState } from "react";

import type { SharedActivity } from "@/app/actions/sharing";
import type { TagMap } from "@/lib/domain/tags";
import { rhythmCategoryLabel } from "@/lib/domain/rhythm-summary";

import { CopyShareModal } from "./copy-share-modal";

function ownerName(s: SharedActivity): string {
  return (
    s.ownerDisplayName ||
    (s.ownerUsername ? `@${s.ownerUsername}` : "A friend")
  );
}

export function SharedList({
  shared,
  tagMap,
}: {
  shared: SharedActivity[];
  tagMap: TagMap;
}) {
  const [copying, setCopying] = useState<SharedActivity | null>(null);

  return (
    <>
      <ul className="flex flex-col gap-3">
        {shared.map((s) => (
          <li
            key={s.shareId}
            className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{s.name}</p>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {rhythmCategoryLabel(s.rhythm, s.scheduledTimes)} · from{" "}
                {ownerName(s)}
              </p>
              {s.defaultSkillTags.length > 0 && (
                <p className="mt-1 truncate text-xs text-zinc-400">
                  {s.defaultSkillTags.map((t) => `#${t}`).join(" ")}
                </p>
              )}
              {!s.shareProgress && (
                <p className="mt-1 text-xs text-zinc-400">
                  Schedule shared (progress hidden)
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCopying(s)}
              className="shrink-0 touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Copy to my schedule
            </button>
          </li>
        ))}
      </ul>

      {copying && (
        <CopyShareModal
          shared={copying}
          tagMap={tagMap}
          onClose={() => setCopying(null)}
        />
      )}
    </>
  );
}
