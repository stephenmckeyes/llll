// ---------------------------------------------------------------------------
// SectionTabs — the top-level section switcher shared by the dashboard
// (Calendar / Grid live at "/") and the Total View page ("/activities").
//
// Three peers, LEFT-to-RIGHT order per user spec:
//   - Total View → /activities  (every activity, grouped + filterable)
//   - Calendar   → /?view=day
//   - Streaks    → /?view=grid&range=week
//
// Calendar sits in the middle intentionally — it's the daily driver
// with Total and Streaks on either side. Rendered at the bottom of
// the schedule surface (bottom-anchored ViewSwitcher / TotalView),
// but always left→right in source order so it reads the same way on
// every surface.
// ---------------------------------------------------------------------------

import Link from "next/link";

import { TabPending } from "./tab-pending";

export type SectionKind = "calendar" | "grid" | "total";

export function SectionTabs({
  active,
  date,
}: {
  active: SectionKind;
  /** YYYY-MM-DD carried into the Calendar/Grid links so hopping sections
   *  keeps the user roughly where they were. */
  date: string;
}) {
  return (
    <nav
      className="flex gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800"
      aria-label="Section"
    >
      <SectionTab
        label="Total View"
        href="/activities"
        active={active === "total"}
      />
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
