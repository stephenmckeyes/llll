"use client";

// ---------------------------------------------------------------------------
// GridNavigator — date controls for the Grid view.
//
// Two rows stacked:
//   1. Friendly label:     "May 11 – 17, 2026"  (or "May 2026", or "All time")
//   2. Controls:           [← date-input → Today]  +  Unlabeled badge
//
// The date input is FIXED WIDTH and sits between the arrows. Same trick
// as DateNavigator: changes in label width on row 1 can't shift the
// arrows on row 2 because they're on a different row.
//
// The Week / Month / Total range tabs live in the page-level
// ViewSwitcher (under the Calendar/Grid section tabs) — they aren't
// rendered here. In Total mode the date-stepping controls hide
// entirely; only the Unlabeled chip remains.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { IncompleteButton, type IncompleteInfo } from "./incomplete-button";

type GridRange = "week" | "month" | "total";

export function GridNavigator({
  range,
  currentDate,
  prevDate,
  nextDate,
  label,
  incompleteInfo,
}: {
  range: GridRange;
  currentDate: string;
  prevDate: string;
  nextDate: string;
  label: string;
  incompleteInfo: IncompleteInfo;
}) {
  const router = useRouter();
  // Derived state from `currentDate` (a prop coming from the URL).
  // React 19 lints the equivalent useEffect; the snapshot pattern
  // mirrors the prop into local state during render itself.
  const [val, setVal] = useState(currentDate);
  const [snapshot, setSnapshot] = useState(currentDate);
  if (snapshot !== currentDate) {
    setSnapshot(currentDate);
    setVal(currentDate);
  }

  // Total mode has no notion of a "current period" or "previous/next"
  // window — it summarizes across all time. Hide the date-stepping
  // controls; just show the label + the Unlabeled chip.
  const isTotal = range === "total";

  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </p>

      <div className="flex items-center justify-center gap-2">
        {!isTotal && (
          <>
            <Link
              href={hrefFor(range, prevDate)}
              aria-label="Previous"
              className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              ←
            </Link>
            <input
              type="date"
              value={val}
              onChange={(e) => {
                setVal(e.target.value);
                if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
                  router.push(hrefFor(range, e.target.value));
                }
              }}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <Link
              href={hrefFor(range, nextDate)}
              aria-label="Next"
              className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              →
            </Link>
            <Link
              href={`/?view=grid&range=${range}`}
              className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              Today
            </Link>
          </>
        )}
        <IncompleteButton info={incompleteInfo} />
      </div>
    </div>
  );
}

function hrefFor(range: GridRange, date: string): string {
  return `/?view=grid&range=${range}&date=${date}`;
}
