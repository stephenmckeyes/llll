"use client";

// ---------------------------------------------------------------------------
// TagPicker — multi-select tag picker for the create / edit activity forms.
//
// Replaces the old free-text "tags, comma separated" input. Two clearly
// labeled sub-sections:
//
//   1. "Attach existing tags" — three ways to pick a tag, ordered by
//      effort cost:
//        a) The 5 most recently created tags as one-tap chips.
//        b) A search input that live-filters the full tag list.
//        c) A dropdown listing every tag (for users who'd rather
//           scroll than type).
//
//   2. "Create a new tag" — inline editor (name + color from a fixed
//      palette) that calls createTag server-side and immediately
//      makes the new tag selectable above.
//
// Form integration: the picker emits one hidden `<input name="tag">`
// per selected tag — the server reads them via
// formData.getAll("tag"). createActivity and updateActivityFields
// both read tags this way.
// ---------------------------------------------------------------------------

import { useMemo, useState, useTransition } from "react";

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

/** Quick-add chips shown above the search input. Capped so the
 *  surface stays compact even for power users with 50+ tags. */
const QUICK_LIMIT = 5;

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
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<TagColor>("emerald");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Sorted tag list — name asc, used for the dropdown + search results.
  // The "recent" list reuses the tagMap's insertion order: newly-created
  // tags get appended in handleCreate, so the LAST 5 entries
  // (reversed) are the most recently created.
  const allTags = useMemo(
    () => Object.values(tagMap).sort((a, b) => a.name.localeCompare(b.name)),
    [tagMap]
  );
  // Quick-add chips ordered by USAGE — count of active activities
  // already using this tag. Most-used first so common tags are one
  // click away. Ties resolved alphabetically. Newly-created tags
  // start at usage=0 and sink to the bottom; they remain selectable
  // via the search input + dropdown below.
  const frequentTags = useMemo(() => {
    return Object.values(tagMap)
      .filter((t) => !selected.includes(t.name))
      .sort((a, b) => {
        if (a.usage !== b.usage) return b.usage - a.usage;
        return a.name.localeCompare(b.name);
      })
      .slice(0, QUICK_LIMIT);
  }, [tagMap, selected]);
  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length === 0) return [];
    return allTags.filter(
      (t) =>
        !selected.includes(t.name) && t.name.toLowerCase().includes(q)
    );
  }, [allTags, search, selected]);
  const unselectedAll = useMemo(
    () => allTags.filter((t) => !selected.includes(t.name)),
    [allTags, selected]
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
    <div className="flex flex-col gap-4">
      {/* Hidden inputs feed the form's FormData. One <input name="tag">
          per selected name — the server reads via formData.getAll("tag"). */}
      {selected.map((name) => (
        <input key={name} type="hidden" name="tag" value={name} />
      ))}

      {/* Selected tags. Click any chip to remove. */}
      {selected.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Selected ({selected.length})
          </p>
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
        </div>
      )}

      {/* ============================================================
          Section 1: Attach existing tags
          ============================================================ */}
      <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Attach existing tags
        </p>

        {/* Quick-add: most recently created tags. Empty state
            (no tags yet) hides the row. */}
        {frequentTags.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] text-zinc-500">
              Most frequent
            </p>
            <div className="flex flex-wrap gap-1.5">
              {frequentTags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.name)}
                  title={`Used by ${t.usage} activit${t.usage === 1 ? "y" : "ies"}`}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tagChipClasses(
                    t.color
                  )}`}
                >
                  + {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Search input — live-filters the full tag list. Matches show
            inline below the input as soon as the user types. */}
        {allTags.length > 0 && (
          <div>
            <label className="block">
              <span className="sr-only">Search tags</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search tags…"
                className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            {search.trim().length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {searchMatches.length === 0 ? (
                  <p className="text-[11px] italic text-zinc-500">
                    No matches. Try a different name, or create a new tag
                    below.
                  </p>
                ) : (
                  searchMatches.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        toggleTag(t.name);
                        setSearch("");
                      }}
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tagChipClasses(
                        t.color
                      )}`}
                    >
                      + {t.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Dropdown — for users who'd rather scroll than type. Native
            <select> handles its own popup, keyboard nav, screen-reader
            support. The blank first option is a sentinel; picking it
            does nothing. */}
        {unselectedAll.length > 0 && (
          <div>
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              Or pick from list:
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    toggleTag(e.target.value);
                    // Reset so the same option can be picked again
                    // after un-toggling (unlikely but possible).
                    e.target.value = "";
                  }
                }}
                className="flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="">— choose a tag —</option>
                {unselectedAll.map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {allTags.length === 0 && (
          <p className="text-[11px] italic text-zinc-500">
            No tags yet. Create one below to get started.
          </p>
        )}
      </div>

      {/* ============================================================
          Section 2: Create a new tag
          ============================================================ */}
      <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Create a new tag
        </p>
        {!creating ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="self-start rounded-md border border-dashed border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            + New tag
          </button>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
