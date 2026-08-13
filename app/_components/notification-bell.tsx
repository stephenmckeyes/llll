// ---------------------------------------------------------------------------
// NotificationBell — the bell + unread badge that links to /notifications.
//
// Extracted from DashboardHeader so it can sit on every top-level surface
// (Schedule, Total, Community, Levels, Adventures, Settings index) — but
// NOT on the pages opened WITHIN those sections, the Add Activity page, or
// any modal. Drop <NotificationBell /> into a page's header where wanted.
// ---------------------------------------------------------------------------

import { NotificationsBadge } from "./notifications-badge";
import { PendingLink } from "./pending-link";

const iconBtnClasses =
  "relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-zinc-300 text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900";

export function NotificationBell() {
  return (
    <PendingLink
      href="/notifications"
      aria-label="Notifications"
      className={iconBtnClasses}
    >
      <BellIcon />
      <NotificationsBadge />
    </PendingLink>
  );
}

function BellIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden
    >
      <path d="M18 16v-5a6 6 0 0 0-12 0v5l-2 2h16z" />
      <path d="M10 20a2 2 0 1 0 4 0" />
    </svg>
  );
}
