"use client";

// ---------------------------------------------------------------------------
// ConflictsList — /notifications section that surfaces today's
// unacknowledged Timeline conflicts. Ack persists cross-device via
// the conflict_acknowledgements table (migration 0036); once ack'd,
// the row disappears from both this list AND the Timeline banner.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  acknowledgeConflict,
  type NotificationConflict,
} from "@/app/actions/conflicts";
import { formatTimeRange } from "@/lib/ui/format-time";
import { useTimeFormat } from "@/lib/ui/format-time-client";

export function ConflictsList({
  conflicts,
}: {
  conflicts: NotificationConflict[];
}) {
  const router = useRouter();
  const timeFormat = useTimeFormat();
  const [locallyAcked, setLocallyAcked] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const visible = conflicts.filter((c) => !locallyAcked.has(c.pairKey));

  function ack(key: string) {
    setLocallyAcked((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    startTransition(async () => {
      await acknowledgeConflict(key);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Conflicts ({visible.length})
      </h2>
      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No scheduling conflicts for today.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((c) => (
            <li
              key={c.pairKey}
              className="rounded-md border-2 border-amber-400 bg-amber-50 p-3 text-sm dark:border-amber-600 dark:bg-amber-950"
            >
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                Scheduling conflict today
              </p>
              <p className="mt-1 text-amber-900/90 dark:text-amber-100">
                <span className="font-medium">{c.a.name}</span> (
                {formatTimeRange(c.a.start, c.a.end, timeFormat)}) overlaps
                with <span className="font-medium">{c.b.name}</span> (
                {formatTimeRange(c.b.start, c.b.end, timeFormat)}).
              </p>
              <div className="mt-2 flex items-center justify-between gap-2">
                <Link
                  href={`/?view=day&date=${c.date}&timeline=1`}
                  className="text-xs font-medium text-amber-900 underline underline-offset-2 dark:text-amber-100"
                >
                  Open Timeline →
                </Link>
                <button
                  type="button"
                  onClick={() => ack(c.pairKey)}
                  className="rounded-md bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  Got it
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
