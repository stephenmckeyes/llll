// ---------------------------------------------------------------------------
// Rhythm validator — Zod schema for activities.rhythm.
//
// Parse incoming data through `rhythmSchema` before insert. If it parses,
// downstream code can trust the shape.
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
  // One-off. Produces exactly one instance on the activity's start_date.
  // Replaces the old standalone "task" concept.
  z.object({ type: z.literal("single") }),

  // Every day.
  z.object({ type: z.literal("daily") }),

  // Specific weekdays — at least one selected.
  z.object({
    type: z.literal("weekdays"),
    days: z.array(dayOfWeekSchema).min(1),
  }),

  // Every N days, counted from the anchor (last completion, or activity
  // start_date for the first occurrence).
  z.object({
    type: z.literal("interval"),
    days: z.number().int().min(1),
  }),

  // N times per period. We store ONE instance per period (anchored to the
  // period's start — Monday for week, 1st for month, today for day) and
  // M:N-link completions to that single instance. The UI shows "Goal X/N"
  // and auto-completes the instance when N is reached.
  //
  // period: "day" is what the UI labels "Multi-Daily".
  z.object({
    type: z.literal("frequency"),
    count: z.number().int().min(1),
    period: periodSchema,
  }),
]);

export type DayOfWeek = z.infer<typeof dayOfWeekSchema>;
export type Period = z.infer<typeof periodSchema>;
export type Rhythm = z.infer<typeof rhythmSchema>;
