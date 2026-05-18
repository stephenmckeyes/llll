"use client";

// ---------------------------------------------------------------------------
// DateNavigator — friendly date label on top, [← input → Today] row below.
//
// The arrows sit immediately to the left/right of the native date input,
// which has a fixed visual width regardless of the date it shows. So the
// arrows stay in EXACTLY the same screen position when the user clicks
// repeatedly to step day-by-day — long date strings like "Saturday, May 23"
// vs "Friday, May 22" no longer push them around.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { IncompleteButton, type IncompleteInfo } from "./incomplete-button";

type ViewKind = "day" | "week" | "month" | "year";

export function DateNavigator({
  view,
  currentDate,
  prevDate,
  nextDate,
  label,
  incompleteInfo,
}: {
  view: ViewKind;
  currentDate: string;
  prevDate: string;
  nextDate: string;
  label: string;
  incompleteInfo: IncompleteInfo;
}) {
  const router = useRouter();
  // Mirror the `currentDate` prop into local state during render rather
  // than in an effect — React 19 lints `useEffect(() => setX(prop),
  // [prop])` because it triggers a cascading render. See React's
  // "you might not need an effect" docs.
  const [val, setVal] = useState(currentDate);
  const [snapshot, setSnapshot] = useState(currentDate);
  if (snapshot !== currentDate) {
    setSnapshot(currentDate);
    setVal(currentDate);
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Friendly label above the controls — changes in length here can't
          shift the arrows below because they're on a different row. */}
      <p className="text-center text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </p>

      <div className="flex items-center justify-center gap-2">
        <Link
          href={hrefFor(view, prevDate)}
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
              router.push(hrefFor(view, e.target.value));
            }
          }}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <Link
          href={hrefFor(view, nextDate)}
          aria-label="Next"
          className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          →
        </Link>
        <Link
          href={`/?view=${view}`}
          className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
        >
          Today
        </Link>
        <IncompleteButton info={incompleteInfo} />
      </div>
    </div>
  );
}

function hrefFor(view: ViewKind, date: string): string {
  return `/?view=${view}&date=${date}`;
}
