"use client";

// ---------------------------------------------------------------------------
// InlineAddRow — bottom of each DaySection. Replaces what used to be a
// dashed "+ Add activity" button that opened the full NewActivityModal.
//
// Now: a real <input> the user can type into directly. On commit (Enter on
// the keyboard, blur outside the row, or tap the ✓ button) we call
// `createQuickSingle(name, dateStr)` — a 'single' rhythm activity for that
// day with safe defaults (no time / tags / reminders, medium priority, not
// on grid). The circled "i" button still opens the full modal for users who
// want the whole form up front.
//
// Why blur-to-commit needs `relatedTarget`: tapping the ✓ button briefly
// blurs the input, which would fire a duplicate create (one from the blur
// path, one from the click). We check `e.relatedTarget` and skip the blur
// commit when the focus is moving to a button inside this row — the
// button's own onClick handles the create.
// ---------------------------------------------------------------------------

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { createQuickSingle } from "@/app/actions/activities";

export function InlineAddRow({
  dateStr,
  onOpenModal,
}: {
  dateStr: string;
  /** Open the full NewActivityModal for this day. Called by the circled
   *  "i" button — for everything the inline input can't express (time,
   *  tags, priority, rhythm other than single, etc.). If the user has
   *  already typed a name into the inline input, we drop it and let the
   *  modal start clean; carrying it over would require plumbing through
   *  NewActivityModal's initial values for one edge case. */
  onOpenModal: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return; // Empty input is a no-op (not an error).
    if (pending) return;
    startTransition(async () => {
      const res = await createQuickSingle(trimmed, dateStr);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setError(null);
      setName("");
      router.refresh();
    });
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-1">
      <div
        className={`flex items-center gap-1 rounded-md border border-dashed px-2 py-1.5 transition-colors ${
          pending
            ? "border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"
            : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-600"
        }`}
      >
        <span aria-hidden className="px-1 text-sm text-zinc-400">
          +
        </span>
        <input
          ref={inputRef}
          type="text"
          value={name}
          maxLength={120}
          placeholder="Add activity"
          enterKeyHint="done"
          disabled={pending}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              // Drop the soft keyboard on iOS so the user sees the row
              // settle visually. The blur fires our `onBlur` handler too,
              // but `commit()` is idempotent (no-op once name is cleared).
              inputRef.current?.blur();
              commit();
            } else if (e.key === "Escape") {
              setName("");
              setError(null);
              inputRef.current?.blur();
            }
          }}
          onBlur={(e) => {
            // Skip commit if focus is moving to our own ✓ or "i" buttons —
            // they handle the click themselves and we'd otherwise fire
            // create twice. Anywhere else (tap off, tab away) commits.
            const next = e.relatedTarget as Node | null;
            if (next && containerRef.current?.contains(next)) return;
            commit();
          }}
          className="min-w-0 flex-1 bg-transparent px-1 py-0.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none disabled:opacity-60 dark:text-zinc-100 dark:placeholder:text-zinc-500"
        />
        {/* ✓ commit button — only enabled when there's text to save. */}
        <button
          type="button"
          onClick={commit}
          disabled={pending || name.trim().length === 0}
          aria-label="Save activity"
          title="Save activity"
          className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:text-zinc-300 dark:text-emerald-300 dark:hover:bg-emerald-950 dark:disabled:text-zinc-700"
        >
          ✓
        </button>
        {/* Circled "i" — open the full modal for everything the inline
            row doesn't capture (time, tags, rhythm, priority, etc.). */}
        <button
          type="button"
          onClick={onOpenModal}
          aria-label="Open full activity form"
          title="More options"
          className="shrink-0 rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-semibold text-zinc-500 transition-colors hover:border-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          i
        </button>
      </div>
      {error && (
        <p className="px-2 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
