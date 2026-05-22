"use client";

// ---------------------------------------------------------------------------
// TabPending — a tiny spinner that appears inside a <Link> while that
// link's navigation is in flight.
//
// Why: switching Calendar↔Grid (or between sub-views) re-renders the
// whole route on the server, which can take a beat on mobile / with a
// distant database. Without feedback the old view just sits there and
// the user wonders if their tap registered (and taps again). This uses
// Next's `useLinkStatus`, which reports the pending state of the
// nearest ancestor <Link>, so a spinner shows the instant you tap.
//
// Must be rendered as a DESCENDANT of the <Link> it reports on.
// ---------------------------------------------------------------------------

import { useLinkStatus } from "next/link";

export function TabPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="ml-1.5 inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent align-[-1px] opacity-70"
    />
  );
}
