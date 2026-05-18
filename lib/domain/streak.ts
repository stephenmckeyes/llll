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

import { addDays, addMonths, format } from "date-fns";

import {
  normalizeFrequencyPeriod,
  type Rhythm,
} from "@/lib/validators/rhythm";

export type StreakInstance = {
  scheduled_for: string;
  status: string;
};

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
