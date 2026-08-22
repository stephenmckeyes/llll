// ---------------------------------------------------------------------------
// Completion mode (migration 0065) — how an occurrence gets resolved.
//
//   'mark' — you must mark it Complete/Missed (the default).
//   'auto' — comment-only; it auto-marks COMPLETE once its date passes.
//   'both' — markable AND auto-completes if left unmarked once past.
//
// Multi-day events (a "Once" activity with end_date > start_date) default to
// 'auto'. This module is the single source of truth for the semantics so the
// form, day list, grid, and completion queries all agree.
// ---------------------------------------------------------------------------

export type CompletionMode = "mark" | "auto" | "both";

export const COMPLETION_MODES: CompletionMode[] = ["mark", "auto", "both"];

export const COMPLETION_MODE_LABEL: Record<CompletionMode, string> = {
  mark: "Mark Complete",
  auto: "Auto-Complete",
  both: "Both",
};

export function coerceCompletionMode(v: unknown): CompletionMode {
  return v === "auto" || v === "both" ? v : "mark";
}

/** Can the viewer manually mark this occurrence Complete/Missed? False for
 *  'auto' (comment-only until its time passes). */
export function canManuallyMark(mode: CompletionMode): boolean {
  return mode !== "auto";
}

/** Does an unmarked occurrence auto-complete once its date/time has passed? */
export function autoCompletesWhenPast(mode: CompletionMode): boolean {
  return mode === "auto" || mode === "both";
}

/**
 * The status to DISPLAY for an occurrence, applying the auto-complete rule at
 * read time: a still-pending 'auto'/'both' occurrence whose day is already in
 * the past reads as completed. (A server-side backfill persists this too, but
 * compute-on-read keeps the UI correct immediately.)
 */
export function effectiveStatus(
  status: string,
  mode: CompletionMode,
  scheduledFor: string,
  todayStr: string
): string {
  if (
    status === "pending" &&
    autoCompletesWhenPast(mode) &&
    scheduledFor < todayStr
  ) {
    return "completed";
  }
  return status;
}
