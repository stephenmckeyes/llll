"use client";

// ---------------------------------------------------------------------------
// ConfirmFuturePicker — toggle the "confirm when completing a future date"
// prompt (client preference, localStorage-backed).
// ---------------------------------------------------------------------------

import {
  setConfirmFutureClient,
  useConfirmFutureComplete,
} from "@/lib/ui/confirm-future-client";

export function ConfirmFuturePicker() {
  const on = useConfirmFutureComplete();
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-zinc-700 dark:text-zinc-300">
        Ask before completing a future-dated occurrence
      </span>
      <button
        type="button"
        onClick={() => setConfirmFutureClient(!on)}
        role="switch"
        aria-checked={on}
        aria-label="Confirm future-date completion"
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          on ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            on ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
