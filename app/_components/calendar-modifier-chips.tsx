"use client";

// ---------------------------------------------------------------------------
// CalendarModifierChips — the "Timeline" + "Filters" pill pair. Pinned
// toward the top of the Calendar surface (right under DashboardHeader)
// so they sit near the sticky date navigator's Today button, per user
// spec: "Keep timeline and filters buttons towards the top of the
// screen next to the 'today' button rather than down at the bottom."
//
// Only rendered on the Calendar section (Day / Week / Month / Year /
// Timeline). Grid has its own tag filter and no Timeline concept.
// ---------------------------------------------------------------------------

import Link from "next/link";

import { CalendarFiltersButton } from "./calendar-filters-button";
import { TabPending } from "./tab-pending";

// Same check-square + clock glyph the previous bottom-anchored copy
// used. Kept local so this component is self-contained.
function CheckSquare({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
        on
          ? "border-white bg-white text-zinc-900 dark:border-zinc-900 dark:bg-zinc-900 dark:text-zinc-50"
          : "border-current bg-transparent text-transparent"
      }`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-2.5 w-2.5"
      >
        <path d="M5 12l5 5L20 7" />
      </svg>
    </span>
  );
}

function ClockIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="h-3 w-3"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function CalendarModifierChips({
  currentView,
  timelineOn,
  allTagNames,
  activeHiddenTags,
}: {
  currentView: "day" | "week" | "month" | "year";
  timelineOn: boolean;
  allTagNames: string[];
  activeHiddenTags: string[];
}) {
  // Toggling Timeline drops the `?date` param intentionally — page.tsx
  // defaults `date` to today when it's missing, so both directions
  // land on the current day. Preserving a stale URL `?date` was
  // causing "Timeline lands on 2027 instead of today" whenever the
  // user had earlier navigated to a specific date.
  return (
    <div className="flex flex-col items-end gap-1">
      <Link
        href={`/?view=${currentView}${timelineOn ? "" : "&timeline=1"}`}
        aria-pressed={timelineOn}
        title="Toggle Timeline overlay"
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
          timelineOn
            ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
            : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
        }`}
      >
        <CheckSquare on={timelineOn} />
        <ClockIcon />
        Timeline
        <TabPending />
      </Link>
      <CalendarFiltersButton
        allTags={allTagNames}
        activeHidden={activeHiddenTags}
      />
    </div>
  );
}
