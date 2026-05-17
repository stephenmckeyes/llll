// ---------------------------------------------------------------------------
// Reminder validator — one entry of the activities.reminders jsonb array.
//
// Shape: { days, hours, minutes } — a duration BEFORE the occurrence.
// Example: { days: 1, hours: 0, minutes: 30 } means "remind me 1 day and
// 30 minutes before the event."
//
// Old shape ({ amount, unit }) is normalized at the app boundary by
// `normalizeReminder` below so old data still renders.
//
// Notification delivery (cron + email/push) is handled separately; this
// schema just guards the shape so we never persist garbage.
// ---------------------------------------------------------------------------

import { z } from "zod";

export const reminderSchema = z
  .object({
    days: z.number().int().min(0).max(30),
    hours: z.number().int().min(0).max(23),
    minutes: z.number().int().min(0).max(59),
  })
  .refine((r) => r.days + r.hours + r.minutes > 0, {
    error: "Reminder must be greater than zero.",
  });

export const remindersSchema = z.array(reminderSchema).max(10);

export type Reminder = z.infer<typeof reminderSchema>;

/**
 * Round-trip helper: take whatever's in the DB (which might be the new
 * {days, hours, minutes} shape or the legacy {amount, unit} shape) and
 * return the new shape. Defends against missing/garbage data too.
 */
export function normalizeReminder(raw: unknown): Reminder {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    // New shape
    if (
      typeof r.days === "number" ||
      typeof r.hours === "number" ||
      typeof r.minutes === "number"
    ) {
      return {
        days: clampInt(r.days, 0, 30),
        hours: clampInt(r.hours, 0, 23),
        minutes: clampInt(r.minutes, 0, 59),
      };
    }
    // Legacy shape — { amount, unit }
    if (typeof r.amount === "number" && typeof r.unit === "string") {
      const a = r.amount;
      switch (r.unit) {
        case "minutes":
          return { days: 0, hours: 0, minutes: Math.min(a, 59) };
        case "hours":
          return { days: 0, hours: Math.min(a, 23), minutes: 0 };
        case "days":
          return { days: Math.min(a, 30), hours: 0, minutes: 0 };
        case "weeks":
          return { days: Math.min(a * 7, 30), hours: 0, minutes: 0 };
      }
    }
  }
  return { days: 0, hours: 0, minutes: 0 };
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}
