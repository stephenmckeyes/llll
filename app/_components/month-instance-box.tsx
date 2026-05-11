"use client";

// ---------------------------------------------------------------------------
// One little checkbox-style square inside a Month-view cell, one per
// instance scheduled that day.
//   - Pending → red empty square; click to mark complete (warns if the
//     date is in the future).
//   - Completed → green square with a ✓ (read-only for v1; uncomplete UX
//     lives in BACKLOG).
//
// The whole cell is wrapped in a Link to the day view; these boxes sit on
// top with pointer-events: auto so they capture their own clicks without
// triggering navigation.
// ---------------------------------------------------------------------------

import { useTransition } from "react";

import { completeInstance } from "@/app/actions/activities";

const TODAY_STR = new Date().toISOString().slice(0, 10);

export function MonthInstanceBox({
  instanceId,
  status,
  scheduledFor,
}: {
  instanceId: string;
  status: string;
  scheduledFor: string;
}) {
  const [isPending, startTransition] = useTransition();

  if (status === "completed") {
    return (
      <span
        aria-label="Completed"
        className="flex h-3 w-3 items-center justify-center rounded-sm bg-emerald-500 text-[8px] font-bold leading-none text-white"
      >
        ✓
      </span>
    );
  }

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (scheduledFor > TODAY_STR) {
      const ok = window.confirm(
        `This is scheduled for ${scheduledFor}, in the future. Mark complete anyway?`
      );
      if (!ok) return;
    }
    startTransition(async () => {
      await completeInstance(instanceId);
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={handleClick}
      aria-label="Mark complete"
      className="h-3 w-3 rounded-sm border border-red-400 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:hover:bg-red-950"
    />
  );
}
