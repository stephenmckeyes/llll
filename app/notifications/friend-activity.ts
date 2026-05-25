// ---------------------------------------------------------------------------
// buildFriendActivityNotifications — synthesize "watch" reminders live from a
// friend's shared occurrences (no cron / delivery pipeline). Pure function so
// it's trivially testable and runs on the Notifications page render.
//
// For each activity the viewer is watching:
//   - notify_each   → one note per recent completion/miss (last 7 days)
//   - notify_daily  → today's status ("completed/missed/hasn't labeled …")
//   - notify_weekly → "X of Y … this week"
// ---------------------------------------------------------------------------

import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import type { Watch } from "@/app/actions/watches";

export type FriendNote = {
  id: string;
  ownerId: string;
  activityId: string;
  message: string;
};

function ownerName(s: SharedActivity): string {
  return (
    s.ownerDisplayName ||
    (s.ownerUsername ? `@${s.ownerUsername}` : "A friend")
  );
}

function addDaysStr(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function friendlyDate(date: string, todayStr: string): string {
  if (date === todayStr) return "today";
  if (date === addDaysStr(todayStr, -1)) return "yesterday";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function buildFriendActivityNotifications({
  watches,
  sharedById,
  instances,
  todayStr,
  weekStart,
}: {
  watches: Watch[];
  sharedById: Map<string, SharedActivity>;
  instances: SharedInstance[];
  todayStr: string;
  weekStart: string;
}): FriendNote[] {
  const notes: FriendNote[] = [];

  const byActivity = new Map<string, SharedInstance[]>();
  for (const i of instances) {
    const arr = byActivity.get(i.activityId);
    if (arr) arr.push(i);
    else byActivity.set(i.activityId, [i]);
  }

  const sevenAgo = addDaysStr(todayStr, -7);

  for (const w of watches) {
    const act = sharedById.get(w.activityId);
    if (!act) continue; // no longer shared with progress → nothing to nudge
    const who = ownerName(act);
    const acti = byActivity.get(w.activityId) ?? [];

    if (w.notifyEach) {
      for (const inst of acti) {
        if (inst.scheduledFor < sevenAgo) continue;
        if (inst.status === "completed" || inst.status === "missed") {
          const verb = inst.status === "completed" ? "completed" : "missed";
          notes.push({
            id: `each:${inst.instanceId}:${inst.status}`,
            ownerId: act.ownerId,
            activityId: act.activityId,
            message: `${who} ${verb} “${act.name}” ${friendlyDate(
              inst.scheduledFor,
              todayStr
            )}.`,
          });
        }
      }
    }

    if (w.notifyDaily) {
      const todayInst = acti.find((i) => i.scheduledFor === todayStr);
      if (todayInst) {
        let message: string;
        if (todayInst.status === "completed") {
          message = `${who} completed “${act.name}” today.`;
        } else if (todayInst.status === "missed") {
          message = `${who} missed “${act.name}” today.`;
        } else {
          message = `${who} hasn’t labeled “${act.name}” today.`;
        }
        notes.push({
          id: `daily:${act.activityId}:${todayStr}`,
          ownerId: act.ownerId,
          activityId: act.activityId,
          message,
        });
      }
    }

    if (w.notifyWeekly) {
      const weekInsts = acti.filter(
        (i) => i.scheduledFor >= weekStart && i.scheduledFor <= todayStr
      );
      const total = weekInsts.length;
      if (total > 0) {
        const done = weekInsts.filter((i) => i.status === "completed").length;
        notes.push({
          id: `weekly:${act.activityId}:${weekStart}`,
          ownerId: act.ownerId,
          activityId: act.activityId,
          message: `${who} has completed ${done} of ${total} “${act.name}” this week.`,
        });
      }
    }
  }

  return notes;
}
