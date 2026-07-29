"use client";

// ---------------------------------------------------------------------------
// AddActivityDensityPicker — a 3-way radio for the profile's
// add_activity_density preference (default / compact / expanded).
//
// Optimistic UI: the visible selection updates instantly, then the server
// action fires in the background. On error the selection reverts to the
// last-known-good value and the error message renders.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import { updateAddActivityDensity } from "@/app/actions/appearance";
import {
  ADD_ACTIVITY_DENSITIES,
  DENSITY_LABELS,
  type AddActivityDensity,
} from "@/lib/domain/add-activity-density";

export function AddActivityDensityPicker({
  initialDensity,
}: {
  initialDensity: AddActivityDensity;
}) {
  const [density, setDensity] = useState<AddActivityDensity>(initialDensity);
  const [savedDensity, setSavedDensity] =
    useState<AddActivityDensity>(initialDensity);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pick(next: AddActivityDensity) {
    if (next === density || isPending) return;
    const prev = density;
    setDensity(next);
    setError(null);
    startTransition(async () => {
      const res = await updateAddActivityDensity(next);
      if ("error" in res) {
        setDensity(prev);
        setError(res.error);
      } else {
        setSavedDensity(next);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {ADD_ACTIVITY_DENSITIES.map((d) => {
          const selected = density === d;
          const { title, hint } = DENSITY_LABELS[d];
          return (
            <button
              key={d}
              type="button"
              onClick={() => pick(d)}
              disabled={isPending}
              className={`flex min-h-[4.5rem] cursor-pointer touch-manipulation flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed ${
                selected
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              <span className="text-sm font-semibold">{title}</span>
              <span
                className={`text-xs ${
                  selected
                    ? "text-zinc-200 dark:text-zinc-700"
                    : "text-zinc-500"
                }`}
              >
                {hint}
              </span>
            </button>
          );
        })}
      </div>
      {isPending && (
        <p className="text-xs text-zinc-500">Saving…</p>
      )}
      {!isPending && density !== savedDensity && (
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
