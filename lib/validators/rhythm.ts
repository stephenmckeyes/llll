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

// Legacy single-unit period — still accepted on read for back-compat.
export const periodSchema = z.enum(["day", "week", "month"]);

// New flexible period unit, used together with `perCount` to express
// "every N days", "every 2 weeks", "every 3 months", etc.
export const periodUnitSchema = z.enum(["days", "weeks", "months"]);

export const rhythmSchema = z.discriminatedUnion("type", [
  // One-off. Produces exactly one instance on the activity's start_date.
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

  // N times per (perCount * perUnit). Examples:
  //   { count: 3, perCount: 1, perUnit: "weeks" } → 3× per week
  //   { count: 5, perCount: 2, perUnit: "weeks" } → 5× per 2 weeks
  //   { count: 4, perCount: 1, perUnit: "days"  } → 4× per day (Multi-Daily)
  //
  // We store ONE instance per period (anchored to the period's start) and
  // M:N-link completions to it. The UI shows "Goal X/N".
  //
  // Legacy data may still have { count, period: "day"|"week"|"month" }
  // instead of { count, perCount, perUnit }. Both shapes are accepted for
  // reads — see normalizeFrequency() in lib/domain/rhythms.ts. New data
  // always uses the new shape.
  z
    .object({
      type: z.literal("frequency"),
      count: z.number().int().min(1).max(99),
      perCount: z.number().int().min(1).max(99).optional(),
      perUnit: periodUnitSchema.optional(),
      period: periodSchema.optional(),
    })
    .refine(
      (r) => (r.perCount !== undefined && r.perUnit !== undefined) || r.period !== undefined,
      { error: "Frequency rhythm needs perCount + perUnit (or legacy period)." }
    ),
]);

export type DayOfWeek = z.infer<typeof dayOfWeekSchema>;
export type Period = z.infer<typeof periodSchema>;
export type PeriodUnit = z.infer<typeof periodUnitSchema>;
export type Rhythm = z.infer<typeof rhythmSchema>;

/**
 * For frequency rhythms — collapse legacy {period} into {perCount, perUnit}.
 * Always returns the new shape.
 */
export function normalizeFrequencyPeriod(rhythm: {
  perCount?: number;
  perUnit?: PeriodUnit;
  period?: Period;
}): { perCount: number; perUnit: PeriodUnit } {
  if (rhythm.perCount !== undefined && rhythm.perUnit !== undefined) {
    return { perCount: rhythm.perCount, perUnit: rhythm.perUnit };
  }
  switch (rhythm.period) {
    case "day":
      return { perCount: 1, perUnit: "days" };
    case "week":
      return { perCount: 1, perUnit: "weeks" };
    case "month":
      return { perCount: 1, perUnit: "months" };
    default:
      return { perCount: 1, perUnit: "weeks" };
  }
}
