// ---------------------------------------------------------------------------
// Shaping helpers that turn a friend's shared activities + occurrences into
// the structures the dashboard's read-only components consume (DayInstance
// for the day list / grid cells, plus the completed/missed dropdown maps).
// Shared by FriendCalendar (real DayList) and FriendGrid (real GridTable).
// ---------------------------------------------------------------------------

import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import type { DayInstance, DayMarkedItem } from "@/app/_components/day-list";

// A specific dated occurrence the user clicked / replied to (the date plus a
// human label for its state). Drives the occurrence detail + the chat quote.
export type Occurrence = { scheduledFor: string; statusLabel: string };

export function occurrenceStatusLabel(
  status: string,
  scheduledFor: string,
  todayStr: string
): string {
  if (status === "completed") return "Completed";
  if (status === "missed") return "Missed";
  if (scheduledFor < todayStr) return "Unlabeled";
  return "Scheduled";
}

// Assemble a DayInstance from a shared occurrence + its parent shared
// activity. Per-occurrence overrides aren't shared, so they're null; tags
// fall back to the activity's current set; reminders are irrelevant to a
// read-only viewer.
export function toDayInstance(
  inst: SharedInstance,
  share: SharedActivity
): DayInstance {
  const status =
    inst.status === "completed" || inst.status === "missed"
      ? inst.status
      : "pending";
  return {
    id: inst.instanceId,
    scheduled_for: inst.scheduledFor,
    status,
    completionCount: inst.completionCount,
    tags: share.defaultSkillTags,
    overrideName: null,
    overrideNotes: null,
    overridePriority: null,
    activity: {
      id: share.activityId,
      name: share.name,
      notes: share.notes,
      rhythm: share.rhythm,
      priority: share.priority,
      scheduled_times: share.scheduledTimes,
      default_skill_tags: share.defaultSkillTags,
      start_date: share.startDate,
      end_date: share.endDate,
      archived_at: share.archivedAt,
      reminders: [],
      // Friend's track_on_grid isn't shared; doesn't matter for the
      // read-only friend view.
      track_on_grid: false,
    },
  };
}

// Split a friend's shared occurrences into the three buckets the DayList
// expects: pending → the active list, completed/missed → the
// Completed/Missed dropdown (keyed by date).
export function buildFriendDayData(
  shares: SharedActivity[],
  instances: SharedInstance[]
): {
  instances: DayInstance[];
  completedByDate: Record<string, DayMarkedItem[]>;
  missedByDate: Record<string, DayMarkedItem[]>;
} {
  const shareById = new Map(shares.map((s) => [s.activityId, s]));
  const pending: DayInstance[] = [];
  const completedByDate: Record<string, DayMarkedItem[]> = {};
  const missedByDate: Record<string, DayMarkedItem[]> = {};

  for (const inst of instances) {
    const share = shareById.get(inst.activityId);
    if (!share) continue;
    const di = toDayInstance(inst, share);
    if (di.status === "completed") {
      (completedByDate[inst.scheduledFor] ??= []).push({
        id: di.id,
        instance: di,
      });
    } else if (di.status === "missed") {
      (missedByDate[inst.scheduledFor] ??= []).push({
        id: di.id,
        instance: di,
      });
    } else {
      pending.push(di);
    }
  }

  return { instances: pending, completedByDate, missedByDate };
}
