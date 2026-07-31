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
              aria-pressed={selected}
              className={`flex cursor-pointer touch-manipulation flex-col items-stretch gap-2 rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed ${
                selected
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              {/* Header: title + a tiny "Selected" badge so users on
                  touch can still tell which is active without color
                  alone (the border already carries most of the signal). */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{title}</span>
                {selected && (
                  <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide dark:bg-black/10">
                    Selected
                  </span>
                )}
              </div>
              {/* Miniature "form" preview — stacked rectangles that
                  mimic label + input + section-break rhythm at the
                  same relative density the picker will apply. Purely
                  decorative (aria-hidden) so screen readers hear the
                  title + hint text below and nothing else. */}
              <DensityPreview
                variant={d}
                selected={selected}
              />
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

// ---------------------------------------------------------------------------
// DensityPreview — a tiny abstract "form" mock. Three rows of alternating
// short label / long input rectangles, spaced tighter for `compact` and
// looser for `expanded`. The visual keeps the picker honest: users pick
// based on what the form will actually look like, not what a word means.
// ---------------------------------------------------------------------------

const PREVIEW_GAP: Record<AddActivityDensity, string> = {
  compact: "gap-[2px]",
  default: "gap-1",
  expanded: "gap-2",
};

const PREVIEW_ROW_H: Record<AddActivityDensity, string> = {
  compact: "h-1.5",
  default: "h-2",
  expanded: "h-2.5",
};

function DensityPreview({
  variant,
  selected,
}: {
  variant: AddActivityDensity;
  selected: boolean;
}) {
  const bar = selected
    ? "bg-white/30 dark:bg-black/20"
    : "bg-zinc-300 dark:bg-zinc-700";
  const label = selected
    ? "bg-white/60 dark:bg-black/40"
    : "bg-zinc-400 dark:bg-zinc-600";
  const rowH = PREVIEW_ROW_H[variant];
  return (
    <div
      aria-hidden
      className={`flex flex-col rounded-sm ${PREVIEW_GAP[variant]} ${
        variant === "compact"
          ? "p-1"
          : variant === "expanded"
            ? "p-2"
            : "p-1.5"
      } ${
        selected
          ? "bg-white/10 dark:bg-black/5"
          : "bg-zinc-100 dark:bg-zinc-900"
      }`}
    >
      {/* Row 1: label (short) + input (wide) */}
      <div className={`${rowH} w-8 rounded-sm ${label}`} />
      <div className={`${rowH} w-full rounded-sm ${bar}`} />
      {/* Row 2 */}
      <div className={`${rowH} w-10 rounded-sm ${label}`} />
      <div className={`${rowH} w-full rounded-sm ${bar}`} />
      {/* Row 3 — split into 2 columns (like Start/End date) */}
      <div className="flex gap-1">
        <div className={`${rowH} w-full rounded-sm ${bar}`} />
        <div className={`${rowH} w-full rounded-sm ${bar}`} />
      </div>
    </div>
  );
}
