"use client";

// ---------------------------------------------------------------------------
// GridNavigator — date controls for the Grid view.
//
// Three layout modes, driven by `range`:
//
//   week / month  — single date picker between ← → arrows. Picking a
//                   date jumps the period to whichever week/month
//                   contains it.
//   total         — no date controls at all (Total spans all time).
//   custom        — TWO date inputs (From / To). Arrows shift the
//                   entire window by its current width.
//
// In every mode the row also hosts the Unlabeled chip and any
// children (used by GridSection to inline the TagFilterPopover so the
// filter doesn't grow the sticky navigator's vertical footprint).
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { IncompleteButton, type IncompleteInfo } from "./incomplete-button";

type GridRange = "week" | "month" | "total" | "custom";

export function GridNavigator({
  range,
  currentDate,
  prevDate,
  nextDate,
  customFrom,
  customTo,
  customPrevFrom,
  customPrevTo,
  customNextFrom,
  customNextTo,
  label,
  incompleteInfo,
  children,
}: {
  range: GridRange;
  currentDate: string;
  prevDate: string;
  nextDate: string;
  /** Current window bounds when range==="custom". Drive the two date
   *  inputs. Both null in every other mode. */
  customFrom: string | null;
  customTo: string | null;
  /** Bounds of the PREV / NEXT custom windows — shifted by the
   *  current window's width on the server. The arrows are plain
   *  <Link>s that point at those URLs. */
  customPrevFrom: string | null;
  customPrevTo: string | null;
  customNextFrom: string | null;
  customNextTo: string | null;
  label: string;
  incompleteInfo: IncompleteInfo;
  children?: React.ReactNode;
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

  // Same snapshot pattern for the two custom-range inputs. We mirror
  // the props into local state so the inputs stay responsive while
  // the user is typing, but resync on every URL change.
  const [fromVal, setFromVal] = useState(customFrom ?? "");
  const [toVal, setToVal] = useState(customTo ?? "");
  const [customSnapshot, setCustomSnapshot] = useState(
    `${customFrom ?? ""}|${customTo ?? ""}`
  );
  const customKey = `${customFrom ?? ""}|${customTo ?? ""}`;
  if (customSnapshot !== customKey) {
    setCustomSnapshot(customKey);
    setFromVal(customFrom ?? "");
    setToVal(customTo ?? "");
  }

  const isTotal = range === "total";
  const isCustom = range === "custom";

  function pushCustom(from: string, to: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return;
    router.push(`/?view=grid&range=custom&from=${from}&to=${to}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-center text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {!isTotal && !isCustom && (
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

        {isCustom && (
          <>
            {customPrevFrom && customPrevTo && (
              <Link
                href={`/?view=grid&range=custom&from=${customPrevFrom}&to=${customPrevTo}`}
                aria-label="Previous window"
                className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                ←
              </Link>
            )}
            <input
              type="date"
              value={fromVal}
              aria-label="From date"
              onChange={(e) => {
                setFromVal(e.target.value);
                pushCustom(e.target.value, toVal);
              }}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <span className="text-xs text-zinc-500">to</span>
            <input
              type="date"
              value={toVal}
              aria-label="To date"
              onChange={(e) => {
                setToVal(e.target.value);
                pushCustom(fromVal, e.target.value);
              }}
              className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            {customNextFrom && customNextTo && (
              <Link
                href={`/?view=grid&range=custom&from=${customNextFrom}&to=${customNextTo}`}
                aria-label="Next window"
                className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                →
              </Link>
            )}
            <Link
              href={`/?view=grid&range=custom`}
              className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              Reset
            </Link>
          </>
        )}

        <IncompleteButton info={incompleteInfo} />
        {children}
      </div>
    </div>
  );
}

function hrefFor(range: GridRange, date: string): string {
  return `/?view=grid&range=${range}&date=${date}`;
}
