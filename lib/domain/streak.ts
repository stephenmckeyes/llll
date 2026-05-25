// ---------------------------------------------------------------------------
// computeStreak — consecutive completed instances ending at the latest
// past-or-current scheduled occurrence.
//
// Walks a DESC-sorted instance list (newest first):
//   - Completed             → streak++
//   - Not completed AND
//     period still in
//     progress (extends
//     past today)           → skip (give the user a chance to finish)
//   - Not completed AND
//     period has ended      → streak ends, return
//
// For non-frequency rhythms the "period" is a single day, so today's
// pending instance is the only one we'd skip. For frequency rhythms a
// whole week / month can still be in progress.
//
// Lives in its own module (not inline in app/page.tsx) so it can be
// unit-tested without dragging in Next / Supabase / the rest of the
// world.
// ---------------------------------------------------------------------------

import {
  addDays,
  addMonths,
  addWeeks,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import {
  normalizeFrequencyPeriod,
  type Rhythm,
} from "@/lib/validators/rhythm";

export type StreakInstance = {
  scheduled_for: string;
  status: string;
};

// ---------------------------------------------------------------------------
// Configurable streak DISPLAY (Settings → Streaks, migration 0015).
//
//   none           — show nothing.
//   perfect_weeks  — consecutive fully-completed weeks (a week with NO
//                    scheduled occurrences is neutral — "take a week off").
//   perfect_months — same, by month.
//   countdown      — a goal countdown (goal − total completed), i.e. how
//                    many left; not a streak, an accumulation toward a target.
//   total          — lifetime count of completed occurrences.
// ---------------------------------------------------------------------------

export type StreakMode =
  | "none"
  | "perfect_weeks"
  | "perfect_months"
  | "countdown"
  | "total";

export const STREAK_MODES: StreakMode[] = [
  "none",
  "perfect_weeks",
  "perfect_months",
  "countdown",
  "total",
];

export function isStreakMode(v: unknown): v is StreakMode {
  return typeof v === "string" && (STREAK_MODES as string[]).includes(v);
}

export function countCompleted(
  instances: ReadonlyArray<StreakInstance>
): number {
  let n = 0;
  for (const i of instances) if (i.status === "completed") n++;
  return n;
}

// Consecutive "perfect" periods (week or month) ending at the current one.
// A period is perfect if it has ≥1 scheduled occurrence and ALL are
// completed. A period with NO occurrences is neutral (skipped, not broken).
// The current (in-progress) period never breaks the streak — if it isn't
// perfect yet we just don't count it.
export function perfectPeriods(
  instances: ReadonlyArray<StreakInstance>,
  unit: "week" | "month",
  todayStr: string
): number {
  if (instances.length === 0) return 0;

  const buckets = new Map<string, { total: number; completed: number }>();
  let earliest = todayStr;
  for (const i of instances) {
    if (i.scheduled_for > todayStr) continue;
    if (i.scheduled_for < earliest) earliest = i.scheduled_for;
    const key = periodStartStr(i.scheduled_for, unit);
    const b = buckets.get(key) ?? { total: 0, completed: 0 };
    b.total++;
    if (i.status === "completed") b.completed++;
    buckets.set(key, b);
  }

  const today = parseLocalDate(todayStr);
  const currentKey = format(periodStartDate(today, unit), "yyyy-MM-dd");
  const earliestKey = periodStartStr(earliest, unit);

  let cursor = periodStartDate(today, unit);
  let streak = 0;
  let guard = 0;
  while (guard < 2000) {
    guard++;
    const key = format(cursor, "yyyy-MM-dd");
    const b = buckets.get(key);
    if (b) {
      if (b.completed === b.total) {
        streak++;
      } else if (key !== currentKey) {
        break; // a finished period that wasn't perfect → streak ends
      }
      // else: current period, not yet perfect → neutral, keep going
    }
    // no bucket → no occurrences that period → neutral, keep going
    if (key === earliestKey) break;
    cursor = unit === "week" ? addWeeks(cursor, -1) : addMonths(cursor, -1);
  }
  return streak;
}

function periodStartDate(d: Date, unit: "week" | "month"): Date {
  return unit === "week"
    ? startOfWeek(d, { weekStartsOn: 1 })
    : startOfMonth(d);
}

function periodStartStr(ymd: string, unit: "week" | "month"): string {
  return format(periodStartDate(parseLocalDate(ymd), unit), "yyyy-MM-dd");
}

// The numeric value to show for a streak mode (display formatting lives in
// the grid's SuccessCell). perfect_* → consecutive perfect periods;
// total/countdown → completed count; none → 0.
export function computeStreakValue(
  mode: StreakMode,
  history: ReadonlyArray<StreakInstance>,
  todayStr: string
): number {
  switch (mode) {
    case "perfect_weeks":
      return perfectPeriods(history, "week", todayStr);
    case "perfect_months":
      return perfectPeriods(history, "month", todayStr);
    case "total":
    case "countdown":
      return countCompleted(history);
    case "none":
    default:
      return 0;
  }
}

export function computeStreak(
  instances: ReadonlyArray<StreakInstance>,
  rhythm: Rhythm,
  todayStr: string
): number {
  let streak = 0;
  for (const inst of instances) {
    if (inst.status === "completed") {
      streak++;
      continue;
    }
    const periodEnd = periodEndDateStr(inst.scheduled_for, rhythm);
    if (periodEnd > todayStr) continue; // still in progress — neutral
    break; // period ended without completion → streak broken
  }
  return streak;
}

// Exclusive period-end date string (first date AFTER the period).
//
// Non-frequency rhythms: period = the single day. End = next day.
// Frequency rhythms: period = perCount × perUnit starting at
// scheduled_for. End = start + that many units.
export function periodEndDateStr(
  scheduledForStr: string,
  rhythm: Rhythm
): string {
  const d = parseLocalDate(scheduledForStr);
  if (rhythm.type !== "frequency") {
    return format(addDays(d, 1), "yyyy-MM-dd");
  }
  const { perCount, perUnit } = normalizeFrequencyPeriod(rhythm);
  if (perUnit === "days") return format(addDays(d, perCount), "yyyy-MM-dd");
  if (perUnit === "weeks") {
    return format(addDays(d, perCount * 7), "yyyy-MM-dd");
  }
  return format(addMonths(d, perCount), "yyyy-MM-dd");
}

function parseLocalDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d);
}
