// ---------------------------------------------------------------------------
// Frequency-period helpers — pure date math for "N times per period" rhythms.
//
// A frequency activity_instance is anchored to a single `scheduled_for` date
// (the start of its period). The PERIOD spans [scheduled_for, periodEnd),
// where periodEnd = scheduled_for + (perCount × perUnit). Days inside that
// interval are "live" — the user has the full window to hit the goal.
//
// "Due day" = the LAST live day = periodEnd − 1. We use it as the landing
// spot for:
//   - the row in the active day list once the period is over and still
//     pending (the "Unlabeled" surface),
//   - a missed-verdict's slot in the Completed/Missed dropdown,
//   - the "jump to oldest unlabeled" deep-link.
//
// The "is unlabeled?" rule for frequency: status === 'pending' AND
// today > dueDay (== today >= periodEnd). Before the period ends, the user
// still has time — it must NOT count as unlabeled (no chip, no
// notification, no past-day row).
//
// All inputs/outputs are 'YYYY-MM-DD' strings parsed as LOCAL dates so the
// math doesn't drift across time zones.
// ---------------------------------------------------------------------------

import {
  normalizeFrequencyPeriod,
  type Rhythm,
} from "@/lib/validators/rhythm";

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatYmd(d: Date): string {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function addUnits(d: Date, count: number, unit: "days" | "weeks" | "months"): Date {
  const out = new Date(d);
  if (unit === "days") out.setDate(out.getDate() + count);
  else if (unit === "weeks") out.setDate(out.getDate() + count * 7);
  else if (unit === "months") out.setMonth(out.getMonth() + count);
  return out;
}

/**
 * Period END (EXCLUSIVE) for a frequency-rhythm instance.
 *
 * The first day NOT in this instance's period — i.e. the start day of the
 * next period. Use `<` against this for "is `day` still inside the period?"
 *
 * Returns scheduled_for unchanged for non-frequency rhythms, so callers can
 * use it as a no-op fallback.
 */
export function frequencyPeriodEnd(
  scheduledFor: string,
  rhythm: Rhythm
): string {
  if (rhythm.type !== "frequency") return scheduledFor;
  const { perCount, perUnit } = normalizeFrequencyPeriod(rhythm);
  return formatYmd(addUnits(parseYmd(scheduledFor), perCount, perUnit));
}

/**
 * Period DUE DAY — the LAST day inside the period (= periodEnd − 1 day).
 *
 * This is the day a still-pending frequency instance "lands on" once the
 * period closes (the Unlabeled-only day in the active list, the dropdown
 * slot for a missed verdict, etc.).
 *
 * Returns scheduled_for unchanged for non-frequency rhythms.
 */
export function frequencyDueDay(
  scheduledFor: string,
  rhythm: Rhythm
): string {
  if (rhythm.type !== "frequency") return scheduledFor;
  const end = frequencyPeriodEnd(scheduledFor, rhythm);
  // dueDay = end − 1 day. Going through Date is fine — end is always
  // scheduled_for + Nx{days|weeks|months}, which has no DST quirks at
  // 00:00 local time.
  const d = parseYmd(end);
  d.setDate(d.getDate() - 1);
  return formatYmd(d);
}

/**
 * "Is this frequency instance past-due (= unlabeled) as of `todayStr`?"
 *
 * True ONLY when the period has fully ended (today >= periodEnd), so a
 * still-open period never trips it. Returns the analogous "scheduled day
 * has passed" rule for non-frequency rhythms, matching legacy behavior.
 */
export function isPastDuePending(
  scheduledFor: string,
  rhythm: Rhythm,
  todayStr: string
): boolean {
  if (rhythm.type === "frequency") {
    return todayStr >= frequencyPeriodEnd(scheduledFor, rhythm);
  }
  return scheduledFor < todayStr;
}

/**
 * Where the "Unlabeled (N)" chip should JUMP — the day the row will
 * actually render on in the active list for this instance.
 *
 * For frequency: dueDay (= periodEnd − 1). For everything else:
 * scheduled_for. Centralized so the chip's URL always agrees with where
 * `visibleOnDay` puts the row.
 */
export function unlabeledLandingDay(
  scheduledFor: string,
  rhythm: Rhythm
): string {
  return rhythm.type === "frequency"
    ? frequencyDueDay(scheduledFor, rhythm)
    : scheduledFor;
}
