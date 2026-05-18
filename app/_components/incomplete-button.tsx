"use client";

// ---------------------------------------------------------------------------
// IncompleteButton — shown next to the "Today" button in every view's
// navigator. Jumps the user to the day view at the OLDEST past-dated
// activity_instance whose status is still `pending` (i.e. the user
// neither completed it nor marked it missed).
//
// Renders a small numeric badge with the total count of those past-due
// instances so the user knows at a glance how much they're behind on.
//
// When count is 0, the button hides entirely — "all caught up" is its
// own UX state and a disabled button would just be visual noise.
//
// Note: this is a Link (full server-render on click) rather than a
// scroll-only jump because the oldest incomplete might be months back,
// past the DayList's rendered window. A consistent navigation behavior
// across all views also keeps the mental model simple — clicking
// Incomplete always lands you on the same Day-view screen.
// ---------------------------------------------------------------------------

import Link from "next/link";

export type IncompleteInfo = {
  count: number;
  oldestDate: string | null;
};

export function IncompleteButton({ info }: { info: IncompleteInfo }) {
  if (info.count === 0 || !info.oldestDate) return null;
  return (
    <Link
      href={`/?view=day&date=${info.oldestDate}`}
      title={`Jump to ${info.oldestDate} — your oldest unfinished activity`}
      aria-label={`${info.count} unfinished — jump to oldest on ${info.oldestDate}`}
      className="relative inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
    >
      Incomplete
      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
        {info.count > 99 ? "99+" : info.count}
      </span>
    </Link>
  );
}
