// ---------------------------------------------------------------------------
// Rhythm-to-instance generator
//
// PURE FUNCTION. The single most architecturally-load-bearing piece of v1:
//   - No database access
//   - No `new Date()` or current-time reads
//   - All inputs explicit; same inputs → same outputs
//
// Output is an array of "instances that should exist for this activity in
// this date range." The caller is responsible for upserting against the DB
// (the (activity_id, scheduled_for) unique index makes this safe).
// ---------------------------------------------------------------------------

import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  format,
  getDay,
  isAfter,
  isBefore,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import type {
  DayOfWeek,
  Period,
  Rhythm,
} from "@/lib/validators/rhythm";

/** Calendar date as 'YYYY-MM-DD' — no time, no timezone. */
export type DateString = string;

export type Instance = { scheduledFor: DateString };

const dayNameToIndex: Record<DayOfWeek, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const toDate = (s: DateString): Date => parseISO(s);
const toString = (d: Date): DateString => format(d, "yyyy-MM-dd");

/**
 * Generate every instance that should exist for `rhythm` within `range`.
 *
 * @param rhythm  the recurrence rule (validated by rhythmSchema before call)
 * @param range   inclusive date window: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 * @param context optional:
 *                  - anchor: last-occurrence date for interval rhythms.
 *                    Defaults to range.from when omitted.
 */
export function generateInstances(
  rhythm: Rhythm,
  range: { from: DateString; to: DateString },
  context: { anchor?: DateString } = {}
): Instance[] {
  const from = toDate(range.from);
  const to = toDate(range.to);
  if (isAfter(from, to)) return [];

  switch (rhythm.type) {
    case "single":
      // Exactly one instance, on range.from (= the activity's start_date
      // when called from createActivity).
      return [{ scheduledFor: range.from }];

    case "daily":
      return generateDaily(from, to);

    case "weekdays":
      return generateWeekdays(rhythm.days, from, to);

    case "interval":
      return generateInterval(
        rhythm.days,
        from,
        to,
        context.anchor ? toDate(context.anchor) : from
      );

    case "frequency":
      // `count` is metadata for the UI ("Goal X/N"); generator emits one
      // instance per period.
      return generateFrequency(rhythm.period, from, to);

    default: {
      const _never: never = rhythm;
      throw new Error(`Unhandled rhythm type: ${JSON.stringify(_never)}`);
    }
  }
}

// ---------------------------------------------------------------------------

function generateDaily(from: Date, to: Date): Instance[] {
  return eachDayOfInterval({ start: from, end: to }).map((d) => ({
    scheduledFor: toString(d),
  }));
}

function generateWeekdays(
  days: DayOfWeek[],
  from: Date,
  to: Date
): Instance[] {
  const targetDows = new Set(days.map((d) => dayNameToIndex[d]));
  return eachDayOfInterval({ start: from, end: to })
    .filter((d) => targetDows.has(getDay(d)))
    .map((d) => ({ scheduledFor: toString(d) }));
}

function generateInterval(
  intervalDays: number,
  from: Date,
  to: Date,
  anchor: Date
): Instance[] {
  const out: Instance[] = [];
  let cursor = anchor;
  while (isBefore(cursor, from)) {
    cursor = addDays(cursor, intervalDays);
  }
  while (!isAfter(cursor, to)) {
    out.push({ scheduledFor: toString(cursor) });
    cursor = addDays(cursor, intervalDays);
  }
  return out;
}

function generateFrequency(
  period: Period,
  from: Date,
  to: Date
): Instance[] {
  const out: Instance[] = [];
  let cursor = startOfPeriod(period, from);
  while (isBefore(cursor, from)) {
    cursor = nextPeriodStart(period, cursor);
  }
  while (!isAfter(cursor, to)) {
    out.push({ scheduledFor: toString(cursor) });
    cursor = nextPeriodStart(period, cursor);
  }
  return out;
}

function startOfPeriod(period: Period, d: Date): Date {
  switch (period) {
    case "day":
      return d;
    case "week":
      return startOfWeek(d, { weekStartsOn: 1 });
    case "month":
      return startOfMonth(d);
  }
}

function nextPeriodStart(period: Period, d: Date): Date {
  switch (period) {
    case "day":
      return addDays(d, 1);
    case "week":
      return addWeeks(d, 1);
    case "month":
      return addMonths(d, 1);
  }
}
