"use client";

// ---------------------------------------------------------------------------
// TagPicker — multi-select tag picker for the create / edit activity forms.
//
// Replaces the old free-text "tags, comma separated" input. Shows the
// user's existing tags as toggleable chips; an inline "+ New tag" panel
// adds a name + color (from a fixed palette) and creates the tag
// server-side via the createTag action.
//
// IMPORTANT — form integration: the picker maintains its own selected-
// names state and renders one hidden <input name="tag"> per selected
// tag. The createActivity / updateActivityFields server actions read
// these via formData.getAll("tag"). This replaces the older
// comma-separated `name="tags"` input, so the corresponding parser on
// the server side switched from `formData.get("tags")` → `getAll("tag")`.
// (See app/actions/activities.ts.)
//
// Tags the user has already used but never colored (legacy free-text
// values that landed before this picker shipped) are still selectable
// — they appear as gray chips in the dropdown alongside colored ones,
// and the user can re-color them at any time via "+ New tag" using the
// same name.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import { createTag } from "@/app/actions/tags";
import {
  TAG_COLORS,
  tagChipClasses,
  tagColorFor,
  tagSwatchClasses,
  type TagColor,
  type TagInfo,
  type TagMap,
} from "@/lib/domain/tags";

export function TagPicker({
  initialSelected = [],
  initialTagMap,
}: {
  initialSelected?: string[];
  /** Existing user tags, keyed by name. The picker rebuilds this
   *  locally as the user creates new tags so newly-added ones become
   *  selectable immediately without a page refresh. */
  initialTagMap: TagMap;
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  // Local mirror of the tag map. Starts from the server-rendered prop
  // and accumulates newly-created tags during this session.
  const [tagMap, setTagMap] = useState<TagMap>(initialTagMap);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<TagColor>("emerald");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const allTags = Object.values(tagMap).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  function toggleTag(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) {
      setError("Tag name can't be empty.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createTag(name, newColor);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const tag: TagInfo = res.tag;
      setTagMap((prev) => ({ ...prev, [tag.name]: tag }));
      setSelected((prev) =>
        prev.includes(tag.name) ? prev : [...prev, tag.name]
      );
      setNewName("");
      setNewColor("emerald");
      setCreating(false);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Hidden inputs feed the form's FormData. One <input name="tag">
          per selected name — the server reads via formData.getAll("tag"). */}
      {selected.map((name) => (
        <input key={name} type="hidden" name="tag" value={name} />
      ))}

      {/* Selected pills — click any to remove. */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((name) => {
            const color = tagColorFor(name, tagMap);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggleTag(name)}
                title="Click to remove"
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tagChipClasses(
                  color
                )}`}
              >
                {name}
                <span aria-hidden className="text-[10px] opacity-70">
                  ✕
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Available-tag chips (unselected). Clicking adds to selection. */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags
            .filter((t) => !selected.includes(t.name))
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => toggleTag(t.name)}
                className={`inline-flex items-center rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium opacity-80 hover:opacity-100 dark:border-zinc-700 ${tagChipClasses(
                  t.color
                )}`}
              >
                + {t.name}
              </button>
            ))}
        </div>
      )}

      {/* "+ New tag" inline editor. Collapsed by default; expanded
          form shows name input + color swatch row. */}
      {!creating ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="self-start rounded-md border border-dashed border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          + New tag
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Name</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={50}
              autoFocus
              placeholder="e.g. fitness, work, family"
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium">Color</span>
            <div className="flex flex-wrap gap-1.5">
              {TAG_COLORS.map((c) => {
                const isSel = c === newColor;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    title={c}
                    className={`h-6 w-6 rounded-full ${tagSwatchClasses(c)} ${
                      isSel
                        ? "ring-2 ring-zinc-900 ring-offset-2 dark:ring-zinc-50 dark:ring-offset-zinc-950"
                        : ""
                    }`}
                  />
                );
              })}
            </div>
          </label>
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending}
              className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {isPending ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setError(null);
              }}
              className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
