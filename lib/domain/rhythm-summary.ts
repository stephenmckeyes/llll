// ---------------------------------------------------------------------------
// rhythm-summary — human-readable one-liner for an activity's schedule.
//
// Used in the All-activities list and (eventually) elsewhere we need a
// short label like "Daily · 7:00 AM" or "Every Mon, Wed, Fri · from May 12".
// ---------------------------------------------------------------------------

import {
  normalizeFrequencyPeriod,
  type Rhythm,
} from "@/lib/validators/rhythm";

const WEEKDAY_LABELS: Record<string, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

export function summarizeRhythm(
  rhythm: Rhythm,
  scheduledTimes: string[] = []
): string {
  switch (rhythm.type) {
    case "single":
      return "Once";
    case "daily":
      return "Every day";
    case "weekdays": {
      const days = rhythm.days
        .map((d) => WEEKDAY_LABELS[d] ?? d)
        .join(", ");
      return `${days}`;
    }
    case "interval":
      return rhythm.days === 1 ? "Every day" : `Every ${rhythm.days} days`;
    case "frequency": {
      const { perCount, perUnit } = normalizeFrequencyPeriod(rhythm);
      // Multi-Daily UX uses frequency-day under the hood; if we know times,
      // surface them in the summary.
      if (perUnit === "days" && perCount === 1 && scheduledTimes.length > 0) {
        return `${rhythm.count}× per day`;
      }
      if (perCount === 1) {
        const singular =
          perUnit === "days" ? "day" : perUnit === "weeks" ? "week" : "month";
        return `${rhythm.count}× per ${singular}`;
      }
      return `${rhythm.count}× per ${perCount} ${perUnit}`;
    }
  }
}

/**
 * Format the date range (start..end) for display. End nullable = open-ended.
 * Singles return just the start date.
 */
export function summarizeDateRange(
  startDate: string,
  endDate: string | null,
  isSingle: boolean
): string {
  if (isSingle) return `on ${shortDate(startDate)}`;
  if (!endDate) return `from ${shortDate(startDate)}`;
  if (endDate === startDate) return `on ${shortDate(startDate)}`;
  return `${shortDate(startDate)} → ${shortDate(endDate)}`;
}

/**
 * Format scheduled times for display: "8:00 AM, 12:00 PM, 6:00 PM".
 * Uses browser locale. Returns "" for no times.
 */
export function summarizeScheduledTimes(times: string[]): string {
  if (times.length === 0) return "";
  return times.map(formatTime).join(", ");
}

// ---------------------------------------------------------------------------

function shortDate(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
