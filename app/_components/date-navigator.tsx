"use client";

// ---------------------------------------------------------------------------
// DateNavigator — ← / → arrows + a date picker that jumps the view to any
// date, plus a "Today" reset. Used by all three calendar views.
//
// Server component owns the data; this client component owns user gestures.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ViewKind = "day" | "week" | "month" | "year";

export function DateNavigator({
  view,
  currentDate,
  prevDate,
  nextDate,
  label,
}: {
  view: ViewKind;
  currentDate: string;
  prevDate: string;
  nextDate: string;
  label: string;
}) {
  const router = useRouter();
  const [val, setVal] = useState(currentDate);
  useEffect(() => setVal(currentDate), [currentDate]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={hrefFor(view, prevDate)}
        aria-label="Previous"
        className="rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        ←
      </Link>
      <span className="min-w-0 flex-1 text-center text-sm font-medium text-zinc-700 dark:text-zinc-300 sm:flex-none sm:px-2">
        {label}
      </span>
      <Link
        href={hrefFor(view, nextDate)}
        aria-label="Next"
        className="rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        →
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
        href={`/?view=${view}`}
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
      >
        Today
      </Link>
    </div>
  );
}

function hrefFor(view: ViewKind, date: string): string {
  return `/?view=${view}&date=${date}`;
}
