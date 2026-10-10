"use client";

// ---------------------------------------------------------------------------
// Public (logged-out) community calendar view — a thin client wrapper that
// renders the shared read-only FriendCalendar over a community's own
// activities. No completion controls, no editing; tapping an occurrence is a
// no-op (there's no detail modal on the public page).
// ---------------------------------------------------------------------------

import { FriendCalendar } from "@/app/friends/[friendId]/friend-calendar";
import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import type { TagMap } from "@/lib/domain/tags";

export function PublicCalendarView({
  shares,
  instances,
  todayStr,
}: {
  shares: SharedActivity[];
  instances: SharedInstance[];
  todayStr: string;
}) {
  // No tag palette on the public page (colors come from the owner's private
  // tag table) — the calendar falls back to its default pill styling.
  const tagMap: TagMap = {};
  return (
    <FriendCalendar
      shares={shares}
      instances={instances}
      todayStr={todayStr}
      tagMap={tagMap}
      onOpenActivity={() => {}}
    />
  );
}
