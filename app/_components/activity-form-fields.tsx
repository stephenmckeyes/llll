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

import { useState } from "react";

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

/** Minimal shape this component needs from an activity. Compatible
 *  with both `DayInstance["activity"]` and the `ActivityRow` used in
 *  /activities — both expose every one of these fields. */
export type ActivityFormInitial = {
  name: string;
  notes: string | null;
  rhythm: Rhythm;
  priority: number;
  scheduled_times: string[];
  default_skill_tags: string[];
  start_date: string;
  end_date: string | null;
  reminders: Array<{ amount: number; unit: string }>;
};

export function ActivityFormFields({
  initialValues,
  blankStartDate = false,
  tagMap,
}: {
  initialValues: ActivityFormInitial;
  /** When true, render the start-date input empty regardless of the
   *  activity's current value. Used by the unarchive flow so the user
   *  is forced to choose a fresh start date. */
  blankStartDate?: boolean;
  tagMap: TagMap;
}) {
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
  const [priority, setPriority] = useState<number>(initialValues.priority);
  const [reminders, setReminders] = useState<Reminder[]>(
    initialValues.reminders.map(normalizeReminder)
  );

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
  function addScheduledTime() {
    setScheduledTimes((prev) => [...prev, "12:00"]);
  }
  function removeScheduledTime(i: number) {
    setScheduledTimes((prev) =>
      prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)
    );
  }

  const intervalDays = Math.max(1, parseInt(intervalDaysStr, 10) || 1);
  const isSingle = rhythmKind === "single";

  return (
    <>
      {/* Hidden inputs surface the field state to FormData. */}
      <input type="hidden" name="rhythmType" value={rhythmKind} />
      <input type="hidden" name="priority" value={priority} />

      {/* --- Activity name ----------------------------------------- */}
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

      {/* --- Notes ------------------------------------------------- */}
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

      {/* --- Tags -------------------------------------------------- */}
      <div className="mt-4">
        <p className="mb-1 text-sm font-medium">Tags</p>
        <TagPicker
          initialSelected={initialValues.default_skill_tags}
          initialTagMap={tagMap}
        />
      </div>

      {/* --- Rhythm kind selector ---------------------------------- */}
      <fieldset className="mt-4 flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Rhythm</legend>
        {(
          [
            ["single", "Once"],
            ["daily", "Daily"],
            ["weekdays", "Specific Days of the Week"],
            ["interval", "Every N Days"],
            ["frequency", "N times per period"],
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

      {/* --- Times of day (unified multi-row list for every rhythm) - */}
      <fieldset className="mt-4">
        <legend className="text-sm font-medium">
          Times of day{" "}
          <span className="font-normal text-zinc-500">
            ({scheduledTimes.length} per day)
          </span>
        </legend>
        <ul className="mt-1 flex flex-col gap-2">
          {scheduledTimes.map((t, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                type="time"
                name="scheduledTime"
                value={t}
                onChange={(e) => updateScheduledTime(i, e.target.value)}
                required
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="button"
                onClick={() => removeScheduledTime(i)}
                disabled={scheduledTimes.length === 1}
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
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

      {/* --- Schedule range (start/end dates) ------------------------ */}
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
            <input
              type="date"
              name="endDate"
              defaultValue={initialValues.end_date ?? ""}
              disabled={isSingle}
              className={`${inputClasses} mt-1`}
            />
          </label>
        </div>
      </fieldset>

      {/* --- Priority (only meaningful for Once) -------------------- */}
      {isSingle && (
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
      <div className="mt-4">
        <RemindersField reminders={reminders} setReminders={setReminders} />
      </div>
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
} {
  const r = a.rhythm;
  // The unified "Times of day" list. Every rhythm uses it; default is
  // a single 12:00 entry if the activity has no scheduled times.
  const scheduledTimes =
    a.scheduled_times.length > 0 ? a.scheduled_times : ["12:00"];
  const defaults = {
    kind: "single" as RhythmKind,
    weekdays: [] as DayOfWeek[],
    intervalDaysStr: "2",
    frequencyCountStr: "3",
    frequencyPerCountStr: "1",
    frequencyPerUnit: "weeks" as PeriodUnit,
    scheduledTimes,
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
