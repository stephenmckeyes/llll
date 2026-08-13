// ---------------------------------------------------------------------------
// DashboardHeader — the "Mission" title + account chips + top-right actions,
// shared by the dashboard ("/") and Total View ("/activities").
//
// Settings and Friends used to live here — they moved to the persistent
// BottomNav (see `app/_components/bottom-nav.tsx`). What remains on top:
//
//   Row 1: Mission title (left)  ·  [Notifications (badge), + Add Activity]
//                                                                (right)
//
// Add Activity is the primary action → biggest chip, top-right of the
// screen per user spec. Everything below shifts up because the old
// second/third rows are gone.
// ---------------------------------------------------------------------------

import { NotificationBell } from "./notification-bell";
import { PendingLink } from "./pending-link";
import { TimeChip } from "./time-chip";

export function DashboardHeader({ userEmail }: { userEmail: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <PendingLink
          href="/"
          ariaLabel="Home — today"
          className="inline-block rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-50"
        >
          <h1
            title="Home — today"
            className="text-3xl font-semibold tracking-tight"
          >
            Mission
          </h1>
        </PendingLink>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
          <span className="truncate">{userEmail}</span>
          <span aria-hidden>·</span>
          <TimeChip />
        </p>
      </div>

      {/* Top-right actions: notifications (still needed — bell + badge)
          and the primary "+ Add Activity" CTA. Settings + Friends live
          in the BottomNav now. */}
      <div className="flex shrink-0 items-center gap-2">
        <NotificationBell />
        <PendingLink
          href="/activities/new"
          className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + Add Activity
        </PendingLink>
      </div>
    </div>
  );
}
