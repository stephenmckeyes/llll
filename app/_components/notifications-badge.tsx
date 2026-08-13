// ---------------------------------------------------------------------------
// NotificationsBadge — a small red pill shown on top of the "Notifications"
// nav link in DashboardHeader. Sums the two things the /notifications page
// gates on as "actually new" (unread DMs + incoming friend requests) so the
// user knows there's something to see without opening it.
//
// Rendered as an async server component so it fetches its own counts —
// keeps DashboardHeader synchronous and its callers unchanged.
// ---------------------------------------------------------------------------

import {
  getIncomingJoinRequests,
  getMyAutoAddEvents,
  getMyPendingInvites,
  getMyRequestOutcomes,
} from "@/app/actions/communities";
import { getUnacknowledgedConflictsForDate } from "@/app/actions/conflicts";
import { getSocialOverview } from "@/app/actions/friends";
import { getUnreadCounts } from "@/app/actions/messages";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function NotificationsBadge() {
  const [
    unread,
    social,
    conflicts,
    invites,
    joinRequests,
    outcomes,
    autoAddEvents,
  ] = await Promise.all([
    getUnreadCounts(),
    getSocialOverview(),
    getUnacknowledgedConflictsForDate(todayYmd()),
    getMyPendingInvites(),
    getIncomingJoinRequests(),
    getMyRequestOutcomes(),
    getMyAutoAddEvents(),
  ]);
  const messages = Object.values(unread).reduce((s, n) => s + n, 0);
  const requests = social.filter(
    (e) => e.status === "pending" && e.direction === "incoming"
  ).length;
  const total =
    messages +
    requests +
    conflicts.length +
    invites.length +
    joinRequests.length +
    outcomes.length +
    autoAddEvents.length;
  if (total <= 0) return null;
  return (
    <span
      aria-label={`${total} unread notification${total === 1 ? "" : "s"}`}
      className="pointer-events-none absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-semibold text-white shadow-sm"
    >
      {total > 99 ? "99+" : total}
    </span>
  );
}
