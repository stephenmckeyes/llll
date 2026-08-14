// ---------------------------------------------------------------------------
// Calendar view-model — the ONE shared vocabulary the personal, friend, and
// community calendars all speak (unification foundation).
//
// Each surface maps its own rows into these shapes, then hands them to the
// shared renderers (WeekBannerPill, MonthCell, YearMonthCell, …). Behavior
// differences (read-only vs editable, collective vs personal completion,
// URL vs in-app navigation) ride on the CalendarCapabilities/handlers below
// rather than being baked into separate component copies.
// ---------------------------------------------------------------------------

import type { Rhythm } from "@/lib/validators/rhythm";

export type OccurrenceStatus = "pending" | "completed" | "missed";

/** One activity as any calendar surface needs to render it. */
export type CalendarActivityView = {
  activityId: string;
  name: string;
  rhythm: Rhythm;
  scheduledTimes: string[];
  scheduledEndTimes: string[];
  tags: string[];
  startDate: string;
  endDate: string | null;
};

/** One occurrence (a day's instance of an activity). */
export type CalendarOccurrenceView = {
  instanceId: string;
  activityId: string;
  scheduledFor: string;
  status: OccurrenceStatus;
  comment: string | null;
};

/**
 * What the current viewer may do on this calendar. A surface (personal /
 * friend / community) sets these; the shared renderers show/hide controls
 * accordingly. Absent handler = control simply isn't rendered.
 */
export type CalendarCapabilities = {
  /** Can mark occurrences complete/missed (personal: own; community:
   *  collective). Friend views are false (read-only). */
  canComplete: boolean;
  /** Can add / edit / archive the calendar's activities. */
  canManage: boolean;
};

export const READ_ONLY_CAPABILITIES: CalendarCapabilities = {
  canComplete: false,
  canManage: false,
};
