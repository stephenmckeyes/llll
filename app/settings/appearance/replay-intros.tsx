"use client";

// ---------------------------------------------------------------------------
// ReplayIntros — a Settings control that clears the user's first-run intro
// acknowledgments (migration 0077) so the intro popups show again. Terms
// acceptances are left intact.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import { resetSeenIntros } from "@/app/actions/agreements";

export function ReplayIntros() {
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function replay() {
    setError(null);
    setDone(false);
    startTransition(async () => {
      const res = await resetSeenIntros();
      if ("error" in res) setError(res.error);
      else setDone(true);
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={replay}
        disabled={isPending}
        className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {isPending ? "Resetting…" : "Replay intros"}
      </button>
      {done && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Done — the intro popups will show again next time you open those pages.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
