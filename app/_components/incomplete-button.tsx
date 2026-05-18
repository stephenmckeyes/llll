"use client";

// ---------------------------------------------------------------------------
// UnlabeledButton (file kept as `incomplete-button.tsx` for backward
// import-path stability) — shown next to the "Today" button in every
// view's navigator. Jumps the user to the day view at the OLDEST past-
// dated activity_instance whose status is still `pending` — i.e. the
// user neither marked it completed nor missed. We call these "unlabeled"
// in the UI because that's what they are from the user's POV: a
// scheduled occurrence that's gone past without a verdict.
//
// (This is the same concept the Grid view used to call "Overdue"; per
// user spec we use one word for it everywhere: "Unlabeled".)
//
// When count is 0, the button hides entirely — "all caught up" is its
// own UX state and a disabled button would just be visual noise.
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
      title={`${info.count} past-due activities still need a verdict — jump to oldest on ${info.oldestDate}`}
      aria-label={`${info.count} unlabeled — jump to oldest on ${info.oldestDate}`}
      className="relative inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
    >
      Unlabeled
      {/* Red circle badge — matches the inline UnlabeledBadge that
          appears next to activity names in the grid view, so the two
          surfaces feel like the same warning. */}
      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
        {info.count > 99 ? "99+" : info.count}
      </span>
    </Link>
  );
}
