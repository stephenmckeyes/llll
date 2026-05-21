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
// When count is 0, the button hides entirely — "all caught up" is its
// own UX state and a disabled button would just be visual noise.
//
// OPTIMISTIC UPDATE: marking an unlabeled instance complete/missed
// dispatches `mission-instance-resolved` (see lib/ui/instance-resolved-
// event). This component subscribes and decrements its local count
// IMMEDIATELY so the chip drops without waiting for the next server
// revalidation. The local count resyncs to props whenever a fresh
// `info` prop arrives (server is truth on every render).
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useEffect, useState } from "react";

import { subscribeInstanceResolved } from "@/lib/ui/instance-resolved-event";

export type IncompleteInfo = {
  count: number;
  oldestDate: string | null;
};

export function IncompleteButton({ info }: { info: IncompleteInfo }) {
  // Local count starts at the server-provided value. We mirror the
  // prop into state during render via the snapshot pattern (React 19
  // lints the equivalent useEffect form). Every new server prop wins
  // — optimistic decrements between renders just hide the chip a bit
  // earlier than the round-trip would.
  const [count, setCount] = useState(info.count);
  const [snapshot, setSnapshot] = useState(info.count);
  if (snapshot !== info.count) {
    setSnapshot(info.count);
    setCount(info.count);
  }

  // Subscribe to instance-resolved events. Each event with
  // wasUnlabeled=true means the user just decided an unlabeled row;
  // drop our count by 1 (floor at 0 so a stale double-fire can't go
  // negative).
  useEffect(() => {
    return subscribeInstanceResolved((detail) => {
      if (!detail.wasUnlabeled) return;
      setCount((c) => Math.max(0, c - 1));
    });
  }, []);

  if (count === 0 || !info.oldestDate) return null;
  return (
    <Link
      href={`/?view=day&date=${info.oldestDate}`}
      title={`${count} past-due activities still need a verdict — jump to oldest on ${info.oldestDate}`}
      aria-label={`${count} unlabeled — jump to oldest on ${info.oldestDate}`}
      className="relative inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
    >
      Unlabeled
      {/* Red circle badge — matches the inline UnlabeledBadge that
          appears next to activity names in the grid view, so the two
          surfaces feel like the same warning. */}
      <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
        {count > 99 ? "99+" : count}
      </span>
    </Link>
  );
}
