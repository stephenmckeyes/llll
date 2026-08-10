"use client";

// ---------------------------------------------------------------------------
// ActivityFormFields — the body of every activity-editing form.
//
// One source of truth for the field set used by:
//   - EditRhythmBody (modal "Edit rhythm" mode for an existing activity)
//   - UnarchiveModal (archive → unarchive flow with a fresh start_date)
//   - (future: /activities/new could also be lifted onto this — left for
//     when we touch the create-activity page)
//
// It owns ALL the field state (rhythm kind, weekdays, scheduled times,
// priority, reminders, etc) so callers don't have to duplicate it. The
// form submission flows through the parent's <form action={…}> via the
// native FormData built from the `name="…"` attributes on each input —
// no React data plumbing needed back up to the caller.
//
// What the caller IS responsible for:
//   - Rendering the surrounding <form> + onSubmit / formAction wiring.
//   - Rendering the submit-button bar (because Edit vs Unarchive want
//     different button labels and counts).
//   - Showing any action-state error message.
// ---------------------------------------------------------------------------

import { useRef, useState } from "react";

import { type AddActivityDensity } from "@/lib/domain/add-activity-density";
import type { TagMap } from "@/lib/domain/tags";
import {
  normalizeReminder,
  type Reminder,
} from "@/lib/validators/reminder";
import {
  normalizeFrequencyPeriod,
  type DayOfWeek,
  type PeriodUnit,
  type Rhythm,
} from "@/lib/validators/rhythm";

import { RemindersField } from "./reminders-field";
import { RolloverButtonGroup } from "./rollover-button-group";
import { TagPicker } from "./tag-picker";

// Locally-scoped rhythm kind (same shape as the legacy one inside
// activity-modal.tsx; kept here so the shared component is self-
// contained).
export type RhythmKind =
  | "single"
  | "daily"
  | "weekdays"
  | "interval"
  | "frequency";

const WEEKDAYS: ReadonlyArray<{ value: DayOfWeek; label: string }> = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

const inputClasses =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50 dark:disabled:bg-zinc-950";

// Reconcile the saved end-times array with the (possibly larger) list
// of start times: unknown / trailing slots become "" (no end time).
function padEndTimes(saved: string[], expectedLength: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < expectedLength; i++) out.push(saved[i] ?? "");
  return out;
}

/** Minimal shape this component needs from an activity. Compatible
 *  with both `DayInstance["activity"]` and the `ActivityRow` used in
 *  /activities — both expose every one of these fields. */
export type ActivityFormInitial = {
  name: string;
  notes: string | null;
  rhythm: Rhythm;
  priority: number;
  scheduled_times: string[];
  /** Parallel array to scheduled_times (migration 0032). "" = no end
   *  time in that slot. Omitted / short array reads as trailing "". */
  scheduled_end_times?: string[];
  default_skill_tags: string[];
  start_date: string;
  end_date: string | null;
  reminders: Array<{ amount: number; unit: string }>;
  /** Show this activity in the Grid view (migration 0016). Everything is
   *  still tracked; this only gates grid display. */
  track_on_grid: boolean;
  /** Migration 0021 — how a MISSED recurring occurrence should behave.
   *  Both default false (legacy: just mark missed). Hidden on single. */
  rollover_missed_days: boolean;
  rollover_change_rhythm: boolean;
  /** Migration 0026. When true, the activity archives itself as soon
   *  as its instance completes (or is finalised as missed for a
   *  single). Default true for new singles, false for recurring. */
  auto_archive: boolean;
};

export function ActivityFormFields({
  initialValues,
  blankStartDate = false,
  tagMap,
  density = "default",
}: {
  initialValues: ActivityFormInitial;
  /** When true, render the start-date input empty regardless of the
   *  activity's current value. Used by the unarchive flow so the user
   *  is forced to choose a fresh start date. */
  blankStartDate?: boolean;
  tagMap: TagMap;
  /** Add Activity form density (migration 0023). "compact" swaps in a
   *  stripped-down JSX that hides all section labels, drops Priority,
   *  turns the rhythm picker into inline text chips, collapses Tags to
   *  a dropdown + New Tag row, and puts both rollover checkboxes on
   *  one line. "expanded" keeps the standard JSX and layers on the
   *  roomier CSS in globals.css. Defaults to "default" so existing
   *  callers stay unchanged. */
  density?: AddActivityDensity;
}) {
  const isCompact = density === "compact";
  const init = initRhythmKindFromActivity(initialValues);
  const [rhythmKind, setRhythmKind] = useState<RhythmKind>(init.kind);
  const [weekdays, setWeekdays] = useState<DayOfWeek[]>(init.weekdays);
  const [intervalDaysStr, setIntervalDaysStr] = useState<string>(
    init.intervalDaysStr
  );
  const [frequencyCountStr, setFrequencyCountStr] = useState<string>(
    init.frequencyCountStr
  );
  const [frequencyPerCountStr, setFrequencyPerCountStr] = useState<string>(
    init.frequencyPerCountStr
  );
  const [frequencyPerUnit, setFrequencyPerUnit] = useState<PeriodUnit>(
    init.frequencyPerUnit
  );
  const [scheduledTimes, setScheduledTimes] = useState<string[]>(
    init.scheduledTimes
  );
  // Parallel array: each entry either "" (no end time) or "HH:MM".
  // Length is kept === scheduledTimes.length by the add/remove/update
  // helpers below so index-based access always lines up.
  const [scheduledEndTimes, setScheduledEndTimes] = useState<string[]>(
    padEndTimes(init.scheduledEndTimes, init.scheduledTimes.length)
  );
  const [priority, setPriority] = useState<number>(initialValues.priority);
  const [reminders, setReminders] = useState<Reminder[]>(
    initialValues.reminders.map(normalizeReminder)
  );
  const [trackOnGrid, setTrackOnGrid] = useState<boolean>(
    initialValues.track_on_grid
  );
  const [rolloverMissedDays, setRolloverMissedDays] = useState<boolean>(
    initialValues.rollover_missed_days
  );
  const [rolloverChangeRhythm, setRolloverChangeRhythm] = useState<boolean>(
    initialValues.rollover_change_rhythm
  );
  const [autoArchive, setAutoArchive] = useState<boolean>(
    initialValues.auto_archive
  );
  // Uncontrolled end-date input needs a ref so the Clear button can
  // reset it to "" (which the server treats as "no end date" →
  // indefinite rhythm). Same for the compact copy of the input.
  const endDateRef = useRef<HTMLInputElement | null>(null);
  const endDateCompactRef = useRef<HTMLInputElement | null>(null);
  function clearEndDate(which: "default" | "compact") {
    const el = which === "default" ? endDateRef.current : endDateCompactRef.current;
    if (el) el.value = "";
  }

  function toggleWeekday(day: DayOfWeek) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }
  function updateScheduledTime(i: number, value: string) {
    setScheduledTimes((prev) =>
      prev.map((t, idx) => (idx === i ? value : t))
    );
  }
  function updateScheduledEndTime(i: number, value: string) {
    setScheduledEndTimes((prev) =>
      prev.map((t, idx) => (idx === i ? value : t))
    );
  }
  function clearScheduledEndTime(i: number) {
    updateScheduledEndTime(i, "");
  }
  function addScheduledTime() {
    setScheduledTimes((prev) => [...prev, "12:00"]);
    setScheduledEndTimes((prev) => [...prev, ""]);
  }
  function removeScheduledTime(i: number) {
    // Time of day is optional now — removing the last row is allowed
    // (an activity with no set time sorts to the end of the day).
    setScheduledTimes((prev) => prev.filter((_, idx) => idx !== i));
    setScheduledEndTimes((prev) => prev.filter((_, idx) => idx !== i));
  }

  const intervalDays = Math.max(1, parseInt(intervalDaysStr, 10) || 1);
  const isSingle = rhythmKind === "single";

  return (
    <>
      {/* Hidden inputs surface the field state to FormData. */}
      <input type="hidden" name="rhythmType" value={rhythmKind} />
      <input type="hidden" name="priority" value={priority} />
      <input
        type="hidden"
        name="trackOnGrid"
        value={trackOnGrid ? "true" : "false"}
      />
      <input
        type="hidden"
        name="rolloverMissedDays"
        value={rolloverMissedDays ? "true" : "false"}
      />
      <input
        type="hidden"
        name="rolloverChangeRhythm"
        value={rolloverChangeRhythm ? "true" : "false"}
      />
      <input
        type="hidden"
        name="autoArchive"
        value={autoArchive ? "true" : "false"}
      />

      {/* --- Activity name ----------------------------------------- */}
      {/* Compact: no "Activity" label — the placeholder carries the
          meaning. Same input DOM either way so form submission is
          identical; only the surrounding label span is dropped. */}
      {isCompact ? (
        <input
          type="text"
          name="name"
          required
          maxLength={120}
          defaultValue={initialValues.name}
          placeholder="Activity name"
          className={inputClasses}
        />
      ) : (
        <label className="block">
          <span className="text-sm font-medium">Activity</span>
          <input
            type="text"
            name="name"
            required
            maxLength={120}
            defaultValue={initialValues.name}
            className={inputClasses}
          />
        </label>
      )}

      {/* --- Notes ------------------------------------------------- */}
      {isCompact ? (
        <textarea
          name="notes"
          rows={2}
          maxLength={500}
          defaultValue={initialValues.notes ?? ""}
          placeholder="Notes"
          className={`${inputClasses} mt-2 resize-none`}
        />
      ) : (
        <label className="mt-4 block">
          <span className="text-sm font-medium">Notes</span>
          <textarea
            name="notes"
            rows={2}
            maxLength={500}
            defaultValue={initialValues.notes ?? ""}
            placeholder="Notes, links, sub-steps…"
            className={`${inputClasses} resize-none`}
          />
        </label>
      )}

      {/* --- Tags -------------------------------------------------- */}
      {/* Compact: TagPicker renders in `compact` mode — one row with a
          native <select> to add + inline "+ New tag" button. Selected
          tags collapse to a tiny inline chip row below so removal
          stays possible. */}
      {isCompact ? (
        <div className="mt-2">
          <TagPicker
            initialSelected={initialValues.default_skill_tags}
            initialTagMap={tagMap}
            compact
          />
        </div>
      ) : (
        <div className="mt-4">
          <p className="mb-1 text-sm font-medium">Tags</p>
          <TagPicker
            initialSelected={initialValues.default_skill_tags}
            initialTagMap={tagMap}
          />
        </div>
      )}

      {/* --- Rhythm kind selector ---------------------------------- */}
      {/* Compact: inline chip flow, buttons sized to text, no radio
          dot — the selected chip fills with the accent color as the
          only affordance. Default / Expanded keep the stacked layout
          with radio dots, restructured to a 2-col grid by density CSS
          in globals.css. */}
      {isCompact ? (
        <div
          data-form-section="rhythm"
          className="mt-2 flex flex-wrap gap-1"
        >
          {(
            [
              ["single", "Once"],
              ["daily", "Daily"],
              ["weekdays", "Days per Week"],
              ["interval", "Every N Days"],
              ["frequency", "Target Count"],
            ] as const
          ).map(([value, label]) => {
            const selected = rhythmKind === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setRhythmKind(value)}
                className={`touch-manipulation rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  selected
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : (
        <fieldset
          data-form-section="rhythm"
          className="mt-4 flex flex-col gap-1"
        >
          <legend className="mb-1 text-sm font-medium">Rhythm</legend>
          {(
            [
              ["single", "Once"],
              ["daily", "Daily"],
              ["weekdays", "Days per Week"],
              ["interval", "Every N Days"],
              ["frequency", "Target Count"],
            ] as const
          ).map(([value, label]) => {
            const selected = rhythmKind === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setRhythmKind(value)}
                className={`flex w-full touch-manipulation items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors ${
                  selected
                    ? "border-zinc-900 bg-zinc-100 dark:border-zinc-50 dark:bg-zinc-900"
                    : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                }`}
              >
                <span
                  aria-hidden
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                    selected
                      ? "border-zinc-900 dark:border-zinc-50"
                      : "border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  {selected && (
                    <span className="h-2 w-2 rounded-full bg-zinc-900 dark:bg-zinc-50" />
                  )}
                </span>
                {label}
              </button>
            );
          })}
        </fieldset>
      )}

      {rhythmKind === "weekdays" && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500">Pick at least one.</p>
          {weekdays.map((day) => (
            <input key={day} type="hidden" name="weekday" value={day} />
          ))}
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => {
              const sel = weekdays.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleWeekday(d.value)}
                  className={`touch-manipulation rounded-md border px-3 py-1.5 text-sm font-medium ${
                    sel
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                      : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {rhythmKind === "interval" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <span className="text-sm">Every</span>
          <input
            type="number"
            name="intervalDays"
            min={1}
            max={365}
            value={intervalDaysStr}
            onChange={(e) => setIntervalDaysStr(e.target.value)}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              setIntervalDaysStr(
                Number.isFinite(n) && n >= 1
                  ? String(Math.min(n, 365))
                  : "1"
              );
            }}
            className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="text-sm">days</span>
          {intervalDays > 1 && (
            <span className="text-xs text-zinc-500">
              ({intervalDays - 1} day{intervalDays - 1 === 1 ? "" : "s"} rest)
            </span>
          )}
        </div>
      )}

      {rhythmKind === "frequency" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <input
            type="number"
            name="frequencyCount"
            min={1}
            max={99}
            value={frequencyCountStr}
            onChange={(e) => setFrequencyCountStr(e.target.value)}
            className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="text-sm">times per</span>
          <input
            type="number"
            name="frequencyPerCount"
            min={1}
            max={99}
            value={frequencyPerCountStr}
            onChange={(e) => setFrequencyPerCountStr(e.target.value)}
            className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <select
            name="frequencyPerUnit"
            value={frequencyPerUnit}
            onChange={(e) =>
              setFrequencyPerUnit(e.target.value as PeriodUnit)
            }
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="days">days</option>
            <option value="weeks">weeks</option>
            <option value="months">months</option>
          </select>
        </div>
      )}

      {/* --- Times of day (optional, multi-row list for every rhythm) - */}
      {isCompact ? (
        /* Compact merges Times + Reminders onto a single flex-wrap
           row separated by a vertical divider — the two are
           semantically related (both "when this fires") and each is
           tiny on its own, so combining them reclaims a whole line
           on phones. The Reminders section further down renders
           nothing in Compact to avoid duplication. */
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {scheduledTimes.map((t, i) => (
              <span key={i} className="flex items-center gap-1">
                <input
                  type="time"
                  name="scheduledTime"
                  value={t}
                  onChange={(e) => updateScheduledTime(i, e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                />
                <span aria-hidden className="text-xs text-zinc-400">
                  –
                </span>
                {/* Parallel hidden input keeps form data lined up even
                    when the end time is empty (server treats "" as
                    "no end time in this slot"). */}
                <input type="hidden" name="scheduledEndTime" value={scheduledEndTimes[i] ?? ""} />
                <input
                  type="time"
                  value={scheduledEndTimes[i] ?? ""}
                  onChange={(e) => updateScheduledEndTime(i, e.target.value)}
                  title="End (optional)"
                  className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                />
                {scheduledEndTimes[i] && (
                  <button
                    type="button"
                    onClick={() => clearScheduledEndTime(i)}
                    aria-label="Clear end time"
                    title="No end time"
                    className="rounded-md border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    ×
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeScheduledTime(i)}
                  aria-label="Remove time"
                  className="rounded-md border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={addScheduledTime}
              className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              + Add time
            </button>
          </div>
          {/* Vertical hairline splits the two groups so it reads as
              "times | reminders" even when both wrap. */}
          <span
            aria-hidden
            className="h-4 w-px shrink-0 bg-zinc-300 dark:bg-zinc-700"
          />
          <RemindersField
            reminders={reminders}
            setReminders={setReminders}
            compact
          />
        </div>
      ) : (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">
            Times of day{" "}
            <span className="font-normal text-zinc-500">
              {scheduledTimes.length > 0
                ? `(${scheduledTimes.length} per day)`
                : "(optional)"}
            </span>
          </legend>
          {scheduledTimes.length === 0 && (
            <p className="mt-1 text-xs text-zinc-500">
              No set time — this sorts to the end of the day.
            </p>
          )}
          <ul className="mt-1 flex flex-col gap-2">
            {scheduledTimes.map((t, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  name="scheduledTime"
                  value={t}
                  onChange={(e) => updateScheduledTime(i, e.target.value)}
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <span aria-hidden className="text-sm text-zinc-400">
                  –
                </span>
                {/* Parallel hidden input keeps the two form arrays
                    lined up by index even when the end time is
                    empty. */}
                <input
                  type="hidden"
                  name="scheduledEndTime"
                  value={scheduledEndTimes[i] ?? ""}
                />
                <input
                  type="time"
                  value={scheduledEndTimes[i] ?? ""}
                  onChange={(e) => updateScheduledEndTime(i, e.target.value)}
                  placeholder="End"
                  title="End time (optional)"
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                {scheduledEndTimes[i] && (
                  <button
                    type="button"
                    onClick={() => clearScheduledEndTime(i)}
                    aria-label="Clear end time"
                    title="No end time"
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    No end
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeScheduledTime(i)}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={addScheduledTime}
            className="mt-2 self-start rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            + Add time
          </button>
        </fieldset>
      )}

      {/* --- Schedule range (start/end dates) ------------------------ */}
      {/* Compact drops the "Schedule" legend and the per-input "Start /
          End date" sub-labels — the browser's native date-picker chrome
          is enough context, and the two inputs sit side-by-side. */}
      {isCompact ? (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            type="date"
            name="startDate"
            required
            defaultValue={blankStartDate ? "" : initialValues.start_date}
            className={inputClasses}
          />
          {/* End-date + tiny "no end date" clear button. Native
              <input type="date"> on iOS has no built-in clear, so the
              explicit × makes going back to "indefinite" obvious. */}
          <div className="relative">
            <input
              ref={endDateCompactRef}
              type="date"
              name="endDate"
              defaultValue={initialValues.end_date ?? ""}
              disabled={isSingle}
              className={`${inputClasses} pr-7`}
            />
            {!isSingle && (
              <button
                type="button"
                onClick={() => clearEndDate("compact")}
                aria-label="Clear end date (indefinite)"
                title="No end date"
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                ×
              </button>
            )}
          </div>
        </div>
      ) : (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Schedule</legend>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-zinc-500">
                Start date
              </span>
              <input
                type="date"
                name="startDate"
                required
                // When `blankStartDate` is set (unarchive flow), force the
                // input empty so the user picks a fresh date. Using
                // `defaultValue` instead of `value` keeps the input
                // uncontrolled and lets the user type/pick freely.
                defaultValue={
                  blankStartDate ? "" : initialValues.start_date
                }
                className={`${inputClasses} mt-1`}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-zinc-500">
                End date{" "}
                <span className="font-normal">
                  {isSingle ? "(n/a for Once)" : "(optional)"}
                </span>
              </span>
              <div className="relative mt-1">
                <input
                  ref={endDateRef}
                  type="date"
                  name="endDate"
                  defaultValue={initialValues.end_date ?? ""}
                  disabled={isSingle}
                  className={`${inputClasses} pr-8`}
                />
                {!isSingle && (
                  <button
                    type="button"
                    onClick={() => clearEndDate("default")}
                    aria-label="Clear end date (indefinite)"
                    title="No end date"
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    ×
                  </button>
                )}
              </div>
              {!isSingle && (
                <button
                  type="button"
                  onClick={() => clearEndDate("default")}
                  className="mt-1 text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 dark:hover:text-zinc-300"
                >
                  No end date (indefinite)
                </button>
              )}
            </label>
          </div>
        </fieldset>
      )}

      {/* --- Priority (only meaningful for Once) -------------------- */}
      {/* Compact drops Priority entirely — the hidden input above still
          submits `priority` from the last-known state (2 / Medium by
          default), so the server keeps a value to write. */}
      {!isCompact && isSingle && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Priority</legend>
          <div className="mt-1 flex gap-2">
            {(
              [
                [1, "High"],
                [2, "Medium"],
                [3, "Low"],
              ] as const
            ).map(([val, label]) => {
              const sel = priority === val;
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => setPriority(val)}
                  className={`flex-1 rounded-md border px-3 py-2 text-center text-sm font-medium ${
                    sel
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                      : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* --- Reminders ---------------------------------------------- */}
      {/* Compact renders Reminders inline with Times above (one
          combined "when this fires" row). Default/Expanded keep the
          full RemindersField section here. */}
      {!isCompact && (
        <div className="mt-4">
          <RemindersField reminders={reminders} setReminders={setReminders} />
        </div>
      )}

      {/* --- Show on Streaks (moved to bottom per user request) ------ */}
      {/* Compact drops the "Streaks" legend and the fieldset border;
          just the two toggle buttons on one row. Internal column stays
          `track_on_grid` — only the label is renamed. */}
      {isCompact ? (
        <div className="mt-2 flex gap-1">
          <button
            type="button"
            onClick={() => setTrackOnGrid(false)}
            className={`flex-1 touch-manipulation rounded-md border px-2 py-1 text-center text-xs font-medium transition-colors ${
              !trackOnGrid
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            Off Streaks
          </button>
          <button
            type="button"
            onClick={() => setTrackOnGrid(true)}
            className={`flex-1 touch-manipulation rounded-md border px-2 py-1 text-center text-xs font-medium transition-colors ${
              trackOnGrid
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            On Streaks
          </button>
        </div>
      ) : (
        <fieldset className="mt-4 flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">Streaks</legend>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTrackOnGrid(false)}
              className={`flex-1 touch-manipulation rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                !trackOnGrid
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              Don&rsquo;t show on Streaks
            </button>
            <button
              type="button"
              onClick={() => setTrackOnGrid(true)}
              className={`flex-1 touch-manipulation rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                trackOnGrid
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              Show on Streaks
            </button>
          </div>
        </fieldset>
      )}

      {/* --- Auto-archive on completion (migration 0026) -------------- */}
      {/* Same button-pair pattern as Grid. When ON, the activity moves
          to Total View's "Past" filter as soon as it completes (or is
          finalised as missed for singles) — keeping the "Active"
          filter free of one-off tasks the user already finished.
          Default is set by the caller (new singles = true, recurring
          = false); user can override either way. */}
      {isCompact ? (
        <div className="mt-2 flex gap-1">
          <button
            type="button"
            onClick={() => setAutoArchive(false)}
            className={`flex-1 touch-manipulation rounded-md border px-2 py-1 text-center text-xs font-medium transition-colors ${
              !autoArchive
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            Keep on Active
          </button>
          <button
            type="button"
            onClick={() => setAutoArchive(true)}
            className={`flex-1 touch-manipulation rounded-md border px-2 py-1 text-center text-xs font-medium transition-colors ${
              autoArchive
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            Auto-archive
          </button>
        </div>
      ) : (
        <fieldset className="mt-4 flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">When done</legend>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAutoArchive(false)}
              className={`flex-1 touch-manipulation rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                !autoArchive
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              Keep on Active
            </button>
            <button
              type="button"
              onClick={() => setAutoArchive(true)}
              className={`flex-1 touch-manipulation rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                autoArchive
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              Auto-archive when done
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Keep on Active if you may reuse this activity. Auto-archive
            moves it to Total View → Past as soon as it completes.
          </p>
        </fieldset>
      )}

      {/* --- Rollover on missed ------------------------------------- */}
      {/* Shown for every rhythm — singles get a single "Rollover missed
          days" toggle (default on = reschedule instead of finalising as
          missed); recurring rhythms get both toggles (defaults off).
          `changeRhythm` is hidden on singles because there's no rhythm
          to shift. */}
      <RolloverButtonGroup
        rhythmKind={rhythmKind}
        rolloverMissedDays={rolloverMissedDays}
        setRolloverMissedDays={setRolloverMissedDays}
        rolloverChangeRhythm={rolloverChangeRhythm}
        setRolloverChangeRhythm={setRolloverChangeRhythm}
        compact={isCompact}
      />
    </>
  );
}

/**
 * Reverse-derive the rhythm-picker form state from an existing activity's
 * rhythm + scheduled_times. Used when initializing the form fields.
 */
function initRhythmKindFromActivity(a: ActivityFormInitial): {
  kind: RhythmKind;
  weekdays: DayOfWeek[];
  intervalDaysStr: string;
  frequencyCountStr: string;
  frequencyPerCountStr: string;
  frequencyPerUnit: PeriodUnit;
  scheduledTimes: string[];
  scheduledEndTimes: string[];
} {
  const r = a.rhythm;
  // The unified "Times of day" list. Optional — an activity may have no
  // set time at all (it then sorts to the end of the day). We surface the
  // activity's saved times verbatim (empty stays empty).
  const scheduledTimes = a.scheduled_times;
  const scheduledEndTimes = a.scheduled_end_times ?? [];
  const defaults = {
    kind: "single" as RhythmKind,
    weekdays: [] as DayOfWeek[],
    intervalDaysStr: "2",
    frequencyCountStr: "3",
    frequencyPerCountStr: "1",
    frequencyPerUnit: "weeks" as PeriodUnit,
    scheduledTimes,
    scheduledEndTimes,
  };

  if (r.type === "single") return { ...defaults, kind: "single" };
  if (r.type === "daily") return { ...defaults, kind: "daily" };
  if (r.type === "weekdays")
    return { ...defaults, kind: "weekdays", weekdays: r.days as DayOfWeek[] };
  if (r.type === "interval")
    return {
      ...defaults,
      kind: "interval",
      intervalDaysStr: String(r.days),
    };
  if (r.type === "frequency") {
    const { perCount, perUnit } = normalizeFrequencyPeriod(r);
    // Legacy "Multi-Daily" was a frequency rhythm with perUnit=days,
    // perCount=1, count > 1. The unified picker doesn't have a
    // separate multi_daily option anymore — Daily + multiple
    // scheduled_times produces the same shape on the server side.
    // So treat the legacy shape as `kind: "daily"` with the current
    // scheduled_times prefilled.
    if (perUnit === "days" && perCount === 1) {
      return { ...defaults, kind: "daily" };
    }
    return {
      ...defaults,
      kind: "frequency",
      frequencyCountStr: String(r.count),
      frequencyPerCountStr: String(perCount),
      frequencyPerUnit: perUnit,
    };
  }
  return defaults;
}
