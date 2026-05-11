// ---------------------------------------------------------------------------
// Rhythm validator — Zod schema for the recurrence rule stored as jsonb on
// recurring_activities.recurrence.
//
// Parse incoming data (from forms, API requests, etc.) through `rhythmSchema`
// before insert. If it parses, downstream code can trust the shape.
// ---------------------------------------------------------------------------

import { z } from "zod";

export const dayOfWeekSchema = z.enum([
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
]);

export const periodSchema = z.enum(["day", "week", "month"]);

export const rhythmSchema = z.discriminatedUnion("type", [
  // Every day.
  z.object({ type: z.literal("daily") }),

  // Specific weekdays — at least one must be selected.
  z.object({
    type: z.literal("weekdays"),
    days: z.array(dayOfWeekSchema).min(1),
  }),

  // Every N days, counted from an anchor (last completion, or
  // activity-created date for the first interval).
  z.object({
    type: z.literal("interval"),
    days: z.number().int().min(1),
  }),

  // N times per period, no specific day. UI shows "Goal X/N".
  // We store ONE instance per period, anchored to the period's start
  // (Monday for week, 1st for month). Completions are M:N-linked.
  z.object({
    type: z.literal("frequency"),
    count: z.number().int().min(1),
    period: periodSchema,
  }),
]);

export type DayOfWeek = z.infer<typeof dayOfWeekSchema>;
export type Period = z.infer<typeof periodSchema>;
export type Rhythm = z.infer<typeof rhythmSchema>;
