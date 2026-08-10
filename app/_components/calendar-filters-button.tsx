"use client";

// ---------------------------------------------------------------------------
// CalendarFiltersButton — "Filters" chip on the Calendar section header.
// Opens a modal listing every tag with checkboxes; on OK, navigates to a
// URL with `?hideTags=` set. Cold-open resets to profile default.
// ---------------------------------------------------------------------------

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { serializeHideTags } from "@/lib/domain/calendar-filter";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

// Small check-square rendered inside the pill to communicate "this is
// a toggle." Matches the visual next to Timeline in page.tsx so the
// pair reads as one control style.
function CheckSquare({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
        on
          ? "border-white bg-white text-zinc-900 dark:border-zinc-900 dark:bg-zinc-900 dark:text-zinc-50"
          : "border-current bg-transparent text-transparent"
      }`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-2.5 w-2.5"
      >
        <path d="M5 12l5 5L20 7" />
      </svg>
    </span>
  );
}

// Small funnel icon for the pill — inherits currentColor so it flips
// with the button's active-state color scheme.
function FunnelIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-3 w-3"
    >
      <path d="M3 4h18l-7 9v6l-4 2v-8L3 4z" />
    </svg>
  );
}

export function CalendarFiltersButton({
  allTags,
  activeHidden,
}: {
  allTags: string[];
  activeHidden: string[];
}) {
  const [open, setOpen] = useState(false);
  const activeCount = activeHidden.length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-pressed={activeCount > 0}
        title="Filter Calendar by tag"
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
          activeCount > 0
            ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
            : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
        }`}
      >
        <CheckSquare on={activeCount > 0} />
        <FunnelIcon />
        Filters
        {activeCount > 0 && (
          <span className="text-[10px] font-semibold opacity-80">
            ({activeCount})
          </span>
        )}
      </button>
      {open && (
        <FiltersModal
          allTags={allTags}
          initialHidden={activeHidden}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function FiltersModal({
  allTags,
  initialHidden,
  onClose,
}: {
  allTags: string[];
  initialHidden: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(initialHidden)
  );
  useBodyScrollLock();

  const sortedTags = useMemo(() => [...allTags].sort(), [allTags]);

  function toggle(tag: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function apply() {
    // Overwrite ?hideTags in the current URL; keep everything else so
    // date / view / timeline toggle survive.
    const qs = new URLSearchParams(params);
    qs.set("hideTags", serializeHideTags(Array.from(hidden)));
    router.push(`?${qs.toString()}`, { scroll: false });
    onClose();
  }

  function clearAll() {
    setHidden(new Set());
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calendar-filters-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div>
            <h2
              id="calendar-filters-title"
              className="text-xl font-semibold tracking-tight"
            >
              Filters
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Check a tag to hide those activities from Calendar.
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
          {sortedTags.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No tags yet. Add one from an activity first, then come back.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {sortedTags.map((tag) => (
                <li key={tag}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900">
                    <input
                      type="checkbox"
                      checked={hidden.has(tag)}
                      onChange={() => toggle(tag)}
                      className="h-4 w-4"
                    />
                    <span>{tag}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            onClick={clearAll}
            disabled={hidden.size === 0}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={apply}
            className="flex-1 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
