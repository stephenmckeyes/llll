"use client";

// ---------------------------------------------------------------------------
// RolloverButtonGroup — two independent yes/no toggles for the two
// rollover flags on activities. Same visual style as the "Off Streaks /
// On Streaks" toggle elsewhere in the form.
//
//   [ Rollover missed? ]  [ No ] [ Yes ]
//   [ Change rhythm?   ]  [ No ] [ Yes ]   (hidden for singles)
//
// Independent booleans, no exclusive-picker logic. Change-rhythm is
// only meaningful when Rollover-missed is On, but we let the user set
// them independently — a stale "Yes / No" combination is treated by
// the domain as "Rollover with no rhythm change." Singles hide the
// second toggle entirely because there's no rhythm to shift.
// ---------------------------------------------------------------------------

import { type RhythmKind } from "./activity-form-fields";

// py trimmed ~1/3 from the earlier px-2 py-2 / px-1.5 py-1 pair so
// the Off / On row doesn't dominate the form's vertical rhythm.
const BUTTON_BASE =
  "flex-1 touch-manipulation rounded-md border px-2 py-1 text-center text-sm font-medium transition-colors";
const BUTTON_BASE_COMPACT =
  "flex-1 touch-manipulation rounded-md border px-2 py-1 text-center text-xs font-medium transition-colors";
const SELECTED =
  "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900";
const UNSELECTED =
  "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

// Module-level so the identity is stable across renders (React 19
// warns against creating components in the render body — state would
// reset every render).
function YesNo({
  on,
  setOn,
  compact,
  offLabel,
  onLabel,
}: {
  on: boolean;
  setOn: (v: boolean) => void;
  compact: boolean;
  /** Text on the OFF (left) button. */
  offLabel: string;
  /** Text on the ON (right) button. */
  onLabel: string;
}) {
  const buttonBase = compact ? BUTTON_BASE_COMPACT : BUTTON_BASE;
  // No left-hand label: the two buttons span the full width and their own
  // text carries the meaning — matching the Streaks / Pinned toggles.
  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={() => setOn(false)}
        aria-pressed={!on}
        className={`${buttonBase} ${!on ? SELECTED : UNSELECTED}`}
      >
        {offLabel}
      </button>
      <button
        type="button"
        onClick={() => setOn(true)}
        aria-pressed={on}
        className={`${buttonBase} ${on ? SELECTED : UNSELECTED}`}
      >
        {onLabel}
      </button>
    </div>
  );
}

export function RolloverButtonGroup({
  rhythmKind,
  rolloverMissedDays,
  setRolloverMissedDays,
  rolloverChangeRhythm,
  setRolloverChangeRhythm,
  compact = false,
}: {
  /** Drives whether the "Change rhythm" toggle appears (recurring
   *  only) and shapes the fine-print warnings. */
  rhythmKind: RhythmKind;
  rolloverMissedDays: boolean;
  setRolloverMissedDays: (v: boolean) => void;
  rolloverChangeRhythm: boolean;
  setRolloverChangeRhythm: (v: boolean) => void;
  /** Add-Activity Compact density — drops the fieldset chrome +
   *  helper + warning bubble, shrinks the buttons. */
  compact?: boolean;
}) {
  const isSingle = rhythmKind === "single";

  // Per-rhythm warnings for surprising combinations. Kept from the
  // exclusive-picker version so users still see the fine-print explanation.
  let missedWarning = "";
  if (rolloverMissedDays && !rolloverChangeRhythm) {
    if (rhythmKind === "daily") {
      missedWarning =
        "Daily activities already generate an instance every day — a make-up won't add anything visible.";
    } else if (rhythmKind === "frequency") {
      missedWarning =
        "For N-times-per-period rhythms, the make-up counts as an extra slot inside the same period.";
    }
  }
  let changeWarning = "";
  if (rolloverChangeRhythm) {
    if (rhythmKind === "daily") {
      changeWarning =
        "Every day is already scheduled — shifting a daily rhythm has no visible effect.";
    } else if (rhythmKind === "weekdays") {
      changeWarning =
        "Shifts every selected weekday by 1 (Mon → Tue, Wed → Thu, …). May change which days the activity lands on.";
    } else if (rhythmKind === "frequency") {
      changeWarning =
        "Shifts the whole period start by 1 day; progress on the current period stays put but future periods move.";
    }
  }

  const missedRow = (
    <YesNo
      on={rolloverMissedDays}
      setOn={setRolloverMissedDays}
      compact={compact}
      offLabel="Don't roll over"
      onLabel="Roll over missed"
    />
  );
  const changeRow = !isSingle && (
    <YesNo
      on={rolloverChangeRhythm}
      setOn={setRolloverChangeRhythm}
      compact={compact}
      offLabel="Keep rhythm"
      onLabel="Change rhythm"
    />
  );

  if (compact) {
    return (
      <div className="mt-2 flex flex-col gap-1.5">
        {missedRow}
        {changeRow}
      </div>
    );
  }

  return (
    <fieldset className="mt-4 flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <legend className="px-1 text-sm font-medium">On missed</legend>
      {missedRow}
      {missedWarning && (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Heads up: {missedWarning}
        </p>
      )}
      {changeRow}
      {changeWarning && (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Heads up: {changeWarning}
        </p>
      )}
    </fieldset>
  );
}
