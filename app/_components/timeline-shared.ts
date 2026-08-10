// ---------------------------------------------------------------------------
// Shared helpers + constants for Calendar Timeline views (day + week).
//
// - Layout constants (HOURS_START / HOURS_END / HOUR_PX) so both views
//   render the same vertical rhythm.
// - `layoutEvents` computes a column-index + column-count per event so
//   overlapping blocks lay out SIDE BY SIDE inside their shared time
//   window instead of stacking opaquely on top of each other. This is
//   the delineation the user asked for: "different activities have
//   clear delineations (even if they overlap) through shading, lines,
//   etc." Each event gets a col/cols pair; consumers turn that into
//   left/width percentages.
// - `detectConflicts` reports overlapping pairs for the notification
//   banner (identical behavior to before this file existed).
// - `minutesFromHhmm` + `effectiveEndMinutes` are the tiny time
//   arithmetic bits both views share.
// ---------------------------------------------------------------------------

// The generic parameter carries whatever per-event metadata the caller
// wants along for the ride — for the personal Day/Week views it's a
// DayInstance so click-to-open-modal works.
export type TimelineEvent<T> = {
  key: string;
  data: T;
  start: string;
  end: string;
};

export type Conflict<T> = { a: TimelineEvent<T>; b: TimelineEvent<T> };

export const HOURS_START = 6;
export const HOURS_END = 24;
export const HOUR_PX = 44;

const DEFAULT_DURATION_MIN = 30;

export function minutesFromHhmm(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

// End default when the activity has no explicit end: 30 minutes past
// start, capped at HOURS_END. Purely visual — the DB stays "".
export function effectiveEndMinutes<T>(ev: TimelineEvent<T>): number {
  if (ev.end) return minutesFromHhmm(ev.end);
  return Math.min(
    minutesFromHhmm(ev.start) + DEFAULT_DURATION_MIN,
    HOURS_END * 60
  );
}

export function detectConflicts<T>(
  events: TimelineEvent<T>[]
): Conflict<T>[] {
  const sorted = [...events].sort(
    (a, b) => minutesFromHhmm(a.start) - minutesFromHhmm(b.start)
  );
  const conflicts: Conflict<T>[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const aEnd = effectiveEndMinutes(a);
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      const bStart = minutesFromHhmm(b.start);
      if (bStart >= aEnd) break;
      conflicts.push({ a, b });
    }
  }
  return conflicts;
}

export function conflictKey<T>(
  scope: string,
  a: TimelineEvent<T>,
  b: TimelineEvent<T>
): string {
  const [x, y] = a.key < b.key ? [a, b] : [b, a];
  return `${scope}|${x.key}|${y.key}`;
}

/**
 * Per-event side-by-side layout for overlapping blocks. Sort by start,
 * pack each event into the first column whose latest block ends by
 * this one's start (first-fit), fall back to a new column otherwise.
 * All events sharing an overlap group get the SAME column count so
 * their widths line up — no stair-step look when three events collide.
 *
 * Returns a map from event key → { col, cols } so callers can render
 * with `left: (col / cols) * 100%; width: 100 / cols%` (minus a gap).
 */
export function layoutEvents<T>(
  events: TimelineEvent<T>[]
): Map<string, { col: number; cols: number }> {
  const sorted = [...events].sort(
    (a, b) => minutesFromHhmm(a.start) - minutesFromHhmm(b.start)
  );
  const out = new Map<string, { col: number; cols: number }>();
  let group: TimelineEvent<T>[] = [];
  let groupEnd = -Infinity;
  const cols: number[] = []; // latest end minute for each column

  function flush() {
    const total = Math.max(1, cols.length);
    for (const ev of group) {
      const prev = out.get(ev.key);
      if (prev) prev.cols = total;
    }
    group = [];
    cols.length = 0;
    groupEnd = -Infinity;
  }

  for (const ev of sorted) {
    const s = minutesFromHhmm(ev.start);
    const e = effectiveEndMinutes(ev);
    if (s >= groupEnd) {
      flush();
    }
    // Find first column with latest end ≤ this event's start.
    let placed = -1;
    for (let i = 0; i < cols.length; i++) {
      if (cols[i] <= s) {
        placed = i;
        break;
      }
    }
    if (placed === -1) {
      placed = cols.length;
      cols.push(e);
    } else {
      cols[placed] = e;
    }
    out.set(ev.key, { col: placed, cols: cols.length });
    group.push(ev);
    groupEnd = Math.max(groupEnd, e);
  }
  flush();
  return out;
}
