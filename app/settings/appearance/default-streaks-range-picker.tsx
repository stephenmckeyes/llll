"use client";

// ---------------------------------------------------------------------------
// DefaultStreaksRangePicker — small segmented picker for the profile's
// default_streaks_range (migration 0029). Same optimistic + revert-on-
// error pattern as the density picker.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import { updateDefaultStreaksRange } from "@/app/actions/appearance";
import {
  STREAKS_RANGES,
  STREAKS_RANGE_LABEL,
  type StreaksRange,
} from "@/lib/domain/streaks-range";

import { Segmented } from "@/app/_components/segmented";

export function DefaultStreaksRangePicker({
  initialRange,
}: {
  initialRange: StreaksRange;
}) {
  const [range, setRange] = useState<StreaksRange>(initialRange);
  const [saved, setSaved] = useState<StreaksRange>(initialRange);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pick(next: string) {
    const val = next as StreaksRange;
    if (val === range || isPending) return;
    const prev = range;
    setRange(val);
    setError(null);
    startTransition(async () => {
      const res = await updateDefaultStreaksRange(val);
      if ("error" in res) {
        setRange(prev);
        setError(res.error);
      } else {
        setSaved(val);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Segmented
        options={STREAKS_RANGES.map((r) => [r, STREAKS_RANGE_LABEL[r]] as const)}
        value={range}
        onChange={pick}
      />
      {isPending && <p className="text-xs text-zinc-500">Saving…</p>}
      {!isPending && range !== saved && (
        <p className="text-xs text-zinc-500">
          Selection reverted — save failed.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
