"use client";

// ---------------------------------------------------------------------------
// TimeFormatPicker — 3-way radio for the profile's time_format preference.
//
// On pick:
//   1. Optimistic UI (selection flips instantly).
//   2. localStorage updates + a `mission:time-format-changed` event fires,
//      so every mounted `useTimeFormat` consumer (day rows, modal times,
//      etc.) re-renders on the new format immediately — no navigation
//      needed.
//   3. Server action persists the profile column so the choice sticks
//      across devices.
// If the server call fails, the selection reverts and the error surfaces.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import { updateTimeFormat } from "@/app/actions/appearance";
import { TIME_FORMATS, formatTime, type TimeFormat } from "@/lib/ui/format-time";
import { setTimeFormatClient } from "@/lib/ui/format-time-client";

const LABEL: Record<TimeFormat, { title: string; hint: string }> = {
  auto: {
    title: "Auto",
    hint: "Follow the device / browser locale — 12h in en-US, 24h in most others.",
  },
  "12h": {
    title: "12-hour",
    hint: "8:00 AM · 5:30 PM",
  },
  "24h": {
    title: "24-hour",
    hint: "08:00 · 17:30",
  },
};

// A single time we render inside each card so users see the choice
// applied without hunting through the app. Noon-ish so 12h and 24h
// look visibly different at a glance (13:15 vs. 1:15 PM).
const PREVIEW_TIME = "13:15";

export function TimeFormatPicker({
  initialFormat,
}: {
  initialFormat: TimeFormat;
}) {
  const [format, setFormat] = useState<TimeFormat>(initialFormat);
  const [saved, setSaved] = useState<TimeFormat>(initialFormat);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pick(next: TimeFormat) {
    if (next === format || isPending) return;
    const prev = format;
    setFormat(next);
    setError(null);
    setTimeFormatClient(next); // instant client-wide update
    startTransition(async () => {
      const res = await updateTimeFormat(next);
      if ("error" in res) {
        setFormat(prev);
        setTimeFormatClient(prev);
        setError(res.error);
      } else {
        setSaved(next);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {TIME_FORMATS.map((f) => {
          const selected = format === f;
          const { title, hint } = LABEL[f];
          return (
            <button
              key={f}
              type="button"
              onClick={() => pick(f)}
              disabled={isPending}
              aria-pressed={selected}
              className={`flex cursor-pointer touch-manipulation flex-col items-start gap-1 rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed ${
                selected
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-sm font-semibold">{title}</span>
                {selected && (
                  <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide dark:bg-black/10">
                    Selected
                  </span>
                )}
              </div>
              {/* Live preview — renders 13:15 in whatever format each
                  card represents. Auto's preview comes from the
                  browser locale so users on non-US locales still see
                  a sensible sample. */}
              <span
                className={`font-mono text-sm ${
                  selected
                    ? "text-zinc-200 dark:text-zinc-700"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                {formatTime(PREVIEW_TIME, f)}
              </span>
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
      {isPending && <p className="text-xs text-zinc-500">Saving…</p>}
      {!isPending && format !== saved && (
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
