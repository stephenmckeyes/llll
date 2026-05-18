"use client";

// ---------------------------------------------------------------------------
// TimeChip — small always-visible display of the user's current local
// time + timezone abbreviation (e.g., "2:34 PM PDT"). Sits in the
// page header so the user can verify Mission is reading their TZ
// correctly even when they're on the road.
//
// Hover (via title attr) reveals the full IANA timezone name like
// "America/Los_Angeles".
//
// Updates every 30s — minute-precision is enough for a date-of-day
// app, and skipping per-second redraws keeps this off the React
// scheduler's hot path.
//
// Hydration-safe: returns null on first render (server has no
// reliable user-local time). The mount-effect installs the time and
// the interval together.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";

export function TimeChip() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    // Capture initial time on mount + tick every 30s.
    const update = () => setNow(new Date());
    update();
    const t = setInterval(update, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!now) return null;

  const timeStr = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  // `toLocaleTimeString` with `timeZoneName: 'short'` returns
  // "2:34:00 PM PDT" — the last token is the short TZ abbrev.
  const tzAbbrev =
    now
      .toLocaleTimeString(undefined, { timeZoneName: "short" })
      .split(" ")
      .pop() ?? "";
  // Full IANA name for the hover tooltip.
  const tzFull = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <span
      title={`Your timezone: ${tzFull}. Change in Settings (coming soon).`}
      className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400"
    >
      <span aria-hidden>🕒</span>
      <span className="tabular-nums">{timeStr}</span>
      <span>{tzAbbrev}</span>
    </span>
  );
}
