// ---------------------------------------------------------------------------
// SectionTabs — the top-level section switcher shared by the dashboard
// (Calendar / Grid live at "/") and the Total View page ("/activities").
//
// Three peers, in line:
//   - Calendar   → /?view=day
//   - Grid       → /?view=grid&range=week
//   - Total View → /activities  (every activity, grouped + filterable)
//
// Kept in its own file so the three tabs render identically on both
// surfaces. The per-section SUB-tabs (Calendar's day/week/month/year,
// Grid's week/month/total/custom) still live in the dashboard's
// ViewSwitcher — Total View has none.
// ---------------------------------------------------------------------------

import Link from "next/link";

import { TabPending } from "./tab-pending";

export type SectionKind = "calendar" | "grid" | "total";

export function SectionTabs({
  active,
  date,
  flipRow = false,
}: {
  active: SectionKind;
  /** YYYY-MM-DD carried into the Calendar/Grid links so hopping sections
   *  keeps the user roughly where they were. */
  date: string;
  /** Reverse the visual left→right order via `flex-row-reverse`. Used
   *  by the dashboard's bottom-anchored ViewSwitcher per user spec
   *  ("invert them ... left to right"). Tab order + click semantics
   *  are unchanged. */
  flipRow?: boolean;
}) {
  return (
    <nav
      className={`flex gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800 ${flipRow ? "flex-row-reverse" : ""}`}
      aria-label="Section"
    >
      <SectionTab
        label="Calendar"
        href={`/?view=day&date=${date}`}
        active={active === "calendar"}
      />
      {/* Internal name stays `grid` (URL param + SectionKind) — only the
          user-facing label is "Streaks". The default range is elided
          so page.tsx can honor the user's default_streaks_range
          preference (Settings → Appearance). */}
      <SectionTab
        label="Streaks"
        href={`/?view=grid&date=${date}`}
        active={active === "grid"}
      />
      <SectionTab label="Total View" href="/activities" active={active === "total"} />
    </nav>
  );
}

function SectionTab({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex flex-1 items-center justify-center rounded px-3 py-1 text-center text-sm font-semibold transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
      }`}
    >
      {label}
      <TabPending />
    </Link>
  );
}
