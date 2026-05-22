// ---------------------------------------------------------------------------
// DashboardHeader — the "Mission" title + account chips + top navigation,
// shared by the dashboard ("/") and Total View ("/activities") so the admin
// buttons appear identically on every section.
//
// Layout (per user spec):
//   Row 1:  Mission title (left)            ·  Settings (top-right)
//   Row 2:                                     + Add Activity (large, far right)
//   Row 3:  Friends (left)                  ·  Notifications (far right)
// ---------------------------------------------------------------------------

import { PendingLink } from "./pending-link";
import { TimeChip } from "./time-chip";

const navClasses =
  "inline-flex items-center rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function DashboardHeader({ userEmail }: { userEmail: string }) {
  return (
    <div className="flex flex-col gap-2">
      {/* Row 1: title + Settings, top-aligned so Settings sits level with
          the top of "Mission" at the very top-right. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">Mission</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
            <span className="truncate">{userEmail}</span>
            <span aria-hidden>·</span>
            <TimeChip />
          </p>
        </div>
        <PendingLink href="/settings" className={`shrink-0 ${navClasses}`}>
          Settings
        </PendingLink>
      </div>

      {/* Row 2: Add Activity — the primary action, larger and far right. */}
      <div className="flex justify-end">
        <PendingLink
          href="/activities/new"
          className="inline-flex items-center rounded-md bg-zinc-900 px-5 py-2.5 text-base font-semibold text-white shadow-sm transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + Add Activity
        </PendingLink>
      </div>

      {/* Row 3: Friends + Notifications grouped together on the right. */}
      <div className="flex items-center justify-end gap-2">
        <PendingLink href="/friends" className={navClasses}>
          Friends
        </PendingLink>
        <PendingLink
          href="/notifications"
          aria-label="Notifications"
          className={navClasses}
        >
          Notifications
        </PendingLink>
      </div>
    </div>
  );
}
