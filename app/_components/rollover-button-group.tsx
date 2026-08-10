"use client";

// ---------------------------------------------------------------------------
// RolloverButtonGroup — mutually-exclusive button row for the two rollover
// flags on activities.
//
//   Singles get 2 buttons: [Off] [Rollover]
//   Recurring gets 3 buttons: [Off] [Rollover] [Rollover + change rhythm]
//
// The DB stays as two independent booleans (rollover_missed_days,
// rollover_change_rhythm) — this is a UI ergonomics change only, matching
// the "Off Grid / On Grid" button style so users on touch can tap without
// hunting for a tiny checkbox. Selection is exclusive because the
// combinations users actually want are the three above; any historical
// (missed=false, change=true) row (impossible via new UI, but harmless
// if it existed) reads as "Rollover + change" via the mapping below.
// ---------------------------------------------------------------------------

import { type RhythmKind } from "./activity-form-fields";

type Mode = "off" | "rollover" | "rolloverChange";

function toMode(missed: boolean, change: boolean): Mode {
  if (change) return "rolloverChange";
  if (missed) return "rollover";
  return "off";
}

const BUTTON_BASE =
  "flex-1 touch-manipulation rounded-md border px-2 py-2 text-center text-sm font-medium transition-colors";
const SELECTED =
  "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900";
const UNSELECTED =
  "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

export function RolloverButtonGroup({
  rhythmKind,
  rolloverMissedDays,
  setRolloverMissedDays,
  rolloverChangeRhythm,
  setRolloverChangeRhythm,
  compact = false,
}: {
  /** The RhythmKind from the parent form's state. Drives whether the
   *  third "change rhythm" button appears (recurring only) and shapes
   *  the fine-print warnings for combinations that behave unusually. */
  rhythmKind: RhythmKind;
  rolloverMissedDays: boolean;
  setRolloverMissedDays: (v: boolean) => void;
  rolloverChangeRhythm: boolean;
  setRolloverChangeRhythm: (v: boolean) => void;
  /** Add-Activity Compact density (migration 0023). Drops the legend +
   *  fine-print helper, shrinks the button padding + font-size, hides
   *  the warning bubble. Still the same button group + selection
   *  semantics — just visually condensed to fit the compact form. */
  compact?: boolean;
}) {
  const isSingle = rhythmKind === "single";
  const mode = toMode(rolloverMissedDays, rolloverChangeRhythm);

  function pick(next: Mode) {
    switch (next) {
      case "off":
        setRolloverMissedDays(false);
        setRolloverChangeRhythm(false);
        return;
      case "rollover":
        setRolloverMissedDays(true);
        setRolloverChangeRhythm(false);
        return;
      case "rolloverChange":
        setRolloverMissedDays(true);
        setRolloverChangeRhythm(true);
        return;
    }
  }

  // Warnings — shown under the button group when the current mode
  // paired with the current rhythm has non-obvious behavior. Same
  // wording as the previous RolloverCheckbox warnings so users get
  // consistent explanations across compact / default.
  let warning = "";
  if (mode === "rollover") {
    if (rhythmKind === "daily") {
      warning =
        "Daily activities already generate an instance every day — a make-up won't add anything visible.";
    } else if (rhythmKind === "frequency") {
      warning =
        "For N-times-per-period rhythms, the make-up counts as an extra slot inside the same period.";
    }
  } else if (mode === "rolloverChange") {
    if (rhythmKind === "daily") {
      warning =
        "Every day is already scheduled — shifting a daily rhythm has no visible effect.";
    } else if (rhythmKind === "weekdays") {
      warning =
        "Shifts every selected weekday by 1 (Mon → Tue, Wed → Thu, …). May change which days the activity lands on.";
    } else if (rhythmKind === "frequency") {
      warning =
        "Shifts the whole period start by 1 day; progress on the current period stays put but future periods move.";
    }
  }

  // Compact drops the fieldset chrome + fine-print helper + warning
  // bubble, and shrinks the button padding + font-size. Same 2- or 3-
  // way exclusive selection.
  const buttonBase = compact
    ? "flex-1 touch-manipulation rounded-md border px-1.5 py-1 text-center text-xs font-medium transition-colors"
    : BUTTON_BASE;

  const buttons = (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => pick("off")}
        aria-pressed={mode === "off"}
        className={`${buttonBase} ${mode === "off" ? SELECTED : UNSELECTED}`}
      >
        {isSingle ? (compact ? "Missed" : "Finalise as missed") : "Off"}
      </button>
      <button
        type="button"
        onClick={() => pick("rollover")}
        aria-pressed={mode === "rollover"}
        className={`${buttonBase} ${
          mode === "rollover" ? SELECTED : UNSELECTED
        }`}
      >
        {isSingle ? (compact ? "Roll" : "Roll forward") : "Rollover"}
      </button>
      {!isSingle && (
        <button
          type="button"
          onClick={() => pick("rolloverChange")}
          aria-pressed={mode === "rolloverChange"}
          className={`${buttonBase} ${
            mode === "rolloverChange" ? SELECTED : UNSELECTED
          }`}
        >
          {compact ? "Roll + shift" : "Rollover + change rhythm"}
        </button>
      )}
    </div>
  );

  if (compact) {
    return <div className="mt-2">{buttons}</div>;
  }

  return (
    <fieldset className="mt-4 flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <legend className="px-1 text-sm font-medium">On missed</legend>
      <p className="text-xs text-zinc-500">
        {isSingle
          ? "Roll a missed task forward instead of finalising it as missed."
          : "How should a missed occurrence adjust the rhythm?"}
      </p>
      {buttons}
      {warning && (
        <p className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Heads up: {warning}
        </p>
      )}
    </fieldset>
  );
}
