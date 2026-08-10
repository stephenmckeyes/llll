"use client";

// ---------------------------------------------------------------------------
// DefaultCalendarFilterPicker — tag checkbox list that writes to
// profiles.default_calendar_hidden_tags (migration 0034). Whatever the
// user checks here is what the Calendar's tag filter starts with on
// cold-open. Default state (nothing checked) = no filter, matching the
// "clear on restart" rule.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import { updateDefaultCalendarHiddenTags } from "@/app/actions/appearance";

export function DefaultCalendarFilterPicker({
  allTags,
  initialHidden,
}: {
  allTags: string[];
  initialHidden: string[];
}) {
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(initialHidden)
  );
  const [saved, setSaved] = useState<Set<string>>(
    () => new Set(initialHidden)
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(tag: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function save() {
    const list = Array.from(hidden);
    setError(null);
    startTransition(async () => {
      const res = await updateDefaultCalendarHiddenTags(list);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setSaved(new Set(list));
    });
  }

  const dirty =
    hidden.size !== saved.size ||
    Array.from(hidden).some((t) => !saved.has(t));

  return (
    <div className="flex flex-col gap-3">
      {allTags.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No tags yet. Add one from an activity first, then come back here.
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-1 rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
            {allTags.map((tag) => {
              const on = hidden.has(tag);
              return (
                <li key={tag}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(tag)}
                      className="h-4 w-4"
                    />
                    <span>{tag}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={isPending || !dirty}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
            <p className="text-xs text-zinc-500">
              {hidden.size === 0
                ? "No default filter — Calendar opens with everything visible."
                : `${hidden.size} tag${hidden.size === 1 ? "" : "s"} hidden by default on cold-open.`}
            </p>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
