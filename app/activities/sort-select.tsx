"use client";

// ---------------------------------------------------------------------------
// SortSelect — small dropdown that swaps a URL query param on change.
// Used in the Archive page to drive server-side sorting of each
// section (Archived + All Activities). Auto-submits on change so the
// user never sees a separate "Apply" button.
// ---------------------------------------------------------------------------

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export type SortKey = "rhythm" | "created" | "lastuse" | "name";

const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "created", label: "Date created (newest)" },
  { value: "name", label: "Name (A→Z)" },
  { value: "rhythm", label: "Rhythm type" },
  { value: "lastuse", label: "Last completion" },
];

export function SortSelect({
  param,
  current,
}: {
  /** URL search-param name this select controls (e.g. "archivedSort"). */
  param: string;
  current: SortKey;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set(param, value);
    startTransition(() => {
      router.push(`/activities?${next.toString()}`);
    });
  }

  // Stop click propagation here (inside the client component) so the
  // parent <details>'s summary-toggle doesn't fire when the user opens
  // / changes the select. The previous setup had an inline onClick on
  // the wrapping span inside a server component, which Next refused to
  // serialize → the Archive page threw on render.
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Same protection for keyboard activation of the summary.
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
      }}
    >
      <select
        value={current}
        onChange={(e) => handleChange(e.target.value)}
        disabled={isPending}
        aria-label="Sort by"
        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </span>
  );
}
