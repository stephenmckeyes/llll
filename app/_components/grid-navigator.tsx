"use client";

// ---------------------------------------------------------------------------
// GridNavigator — top bar of the Grid view.
//
// Three rows stacked:
//   1. Range tabs:        [Week] [Month]
//   2. Friendly label:     "May 11 – 17, 2026"  (or "May 2026")
//   3. Controls:           [← date-input → Today]
//
// The date input is FIXED WIDTH and sits between the arrows. Same trick
// as DateNavigator: changes in label width on row 2 can't shift the
// arrows on row 3 because they're on a different row, and the input
// itself doesn't change width when the date string changes.
//
// Range tabs preserve the current date; switching from week → month
// keeps the same day in view, just shows the surrounding month instead.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type GridRange = "week" | "month";

export function GridNavigator({
  range,
  currentDate,
  prevDate,
  nextDate,
  label,
}: {
  range: GridRange;
  currentDate: string;
  prevDate: string;
  nextDate: string;
  label: string;
}) {
  const router = useRouter();
  // Derived state from `currentDate` (a prop coming from the URL).
  // React 19 lints `useEffect(() => setX(prop), [prop])` because it
  // causes a cascading render. The pattern below mirrors the prop into
  // local state during render itself — recommended in React's
  // "you might not need an effect" doc.
  const [val, setVal] = useState(currentDate);
  const [snapshot, setSnapshot] = useState(currentDate);
  if (snapshot !== currentDate) {
    setSnapshot(currentDate);
    setVal(currentDate);
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Range tabs — preserve the in-view date, just change the window
          width around it. */}
      <nav
        className="mx-auto flex w-fit gap-1 rounded-md border border-zinc-200 p-1 dark:border-zinc-800"
        aria-label="Grid range"
      >
        {(["week", "month"] as const).map((r) => {
          const active = r === range;
          return (
            <Link
              key={r}
              href={hrefFor(r, currentDate)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
              }`}
            >
              {r === "week" ? "Week" : "Month"}
            </Link>
          );
        })}
      </nav>

      {/* Friendly label on its own row so its width can never shift the
          arrows below. */}
      <p className="text-center text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </p>

      <div className="flex items-center justify-center gap-2">
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
      </div>
    </div>
  );
}

function hrefFor(range: GridRange, date: string): string {
  return `/?view=grid&range=${range}&date=${date}`;
}
