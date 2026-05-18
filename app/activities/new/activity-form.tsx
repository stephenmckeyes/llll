"use client";

// ---------------------------------------------------------------------------
// Unified Add-Activity form with live calendar preview.
//
// All rhythm/date inputs are controlled so the preview can recompute on
// every keystroke. Submission still uses Server Action FormData — the
// controlled value attributes flow through naturally.
// ---------------------------------------------------------------------------

import { useActionState, useState } from "react";

import {
  createActivity,
  type ActivityFormState,
} from "@/app/actions/activities";
import type {
  DayOfWeek,
  PeriodUnit,
  Rhythm,
} from "@/lib/validators/rhythm";

import { RemindersField } from "@/app/_components/reminders-field";
import type { Reminder } from "@/lib/validators/reminder";

import { CalendarPreview } from "./calendar-preview";

type RhythmKind =
  | "single"
  | "selection"
  | "multi_daily"
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

const TODAY_ISO = new Date().toISOString().slice(0, 10);

const DEFAULT_MULTI_DAILY_TIMES = ["08:00", "18:00"];

export function ActivityForm() {
  const [state, formAction, isPending] = useActionState<
    ActivityFormState,
    FormData
  >(createActivity, null);

  // ---- Controlled inputs that the preview depends on --------------------
  //
  // Number inputs use *string* state so the user can clear the field and
  // retype without the value snapping back to the previous number on every
  // keystroke. We coerce to a sensible number for the preview only.
  const [name, setName] = useState<string>("");
  const [rhythmKind, setRhythmKind] = useState<RhythmKind>("single");
  const [weekdays, setWeekdays] = useState<DayOfWeek[]>([]);
  const [intervalDaysStr, setIntervalDaysStr] = useState<string>("2");
  const [frequencyCountStr, setFrequencyCountStr] = useState<string>("3");
  const [frequencyPerCountStr, setFrequencyPerCountStr] = useState<string>("1");
  const [frequencyPerUnit, setFrequencyPerUnit] =
    useState<PeriodUnit>("weeks");
  const [multiDailyTimes, setMultiDailyTimes] = useState<string[]>(
    DEFAULT_MULTI_DAILY_TIMES
  );
  const [startDate, setStartDate] = useState<string>(TODAY_ISO);
  const [endDate, setEndDate] = useState<string>("");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  // Unrhythmic Selection: extra start dates BEYOND the primary one.
  // Each entry produces an additional `single` activity sharing every
  // other field. See createActivity's "selection" branch for the
  // server-side fan-out.
  const [extraStartDates, setExtraStartDates] = useState<string[]>([]);

  // Parsed numbers for preview computation. Empty / invalid input falls
  // back to 1 so the calendar still renders something while you're typing.
  const intervalDays = Math.max(1, parseInt(intervalDaysStr, 10) || 1);
  const frequencyCount = Math.max(1, parseInt(frequencyCountStr, 10) || 1);
  const frequencyPerCount = Math.max(
    1,
    parseInt(frequencyPerCountStr, 10) || 1
  );

  const isSingle = rhythmKind === "single";
  const isSelection = rhythmKind === "selection";
  const isMultiDaily = rhythmKind === "multi_daily";
  // "selection" is shown to the server as a flag — each picked date
  // becomes its own `single` activity. So for the preview / end-date
  // logic, treat selection the same as single.
  const isSingleLike = isSingle || isSelection;

  // Force end_date == start_date for singles (the server enforces this too).
  const effectiveEndDate = isSingleLike ? startDate : endDate || null;

  // Compute the rhythm shape the preview should render.
  const previewRhythm = derivePreviewRhythm({
    kind: rhythmKind,
    weekdays,
    intervalDays,
    frequencyCount,
    frequencyPerCount,
    frequencyPerUnit,
    multiDailyTimes,
  });

  // ---- Multi-Daily times handlers ---------------------------------------
  function updateMultiDailyTime(i: number, value: string) {
    setMultiDailyTimes((prev) =>
      prev.map((t, idx) => (idx === i ? value : t))
    );
  }
  function addMultiDailyTime() {
    setMultiDailyTimes((prev) => [...prev, "12:00"]);
  }
  function removeMultiDailyTime(i: number) {
    setMultiDailyTimes((prev) =>
      prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)
    );
  }

  // ---- Weekday checkbox handler -----------------------------------------
  function toggleWeekday(day: DayOfWeek) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  // ---- Selection extra-date handlers ------------------------------------
  function addExtraStartDate() {
    setExtraStartDates((prev) => [...prev, TODAY_ISO]);
  }
  function updateExtraStartDate(i: number, value: string) {
    setExtraStartDates((prev) =>
      prev.map((d, idx) => (idx === i ? value : d))
    );
  }
  function removeExtraStartDate(i: number) {
    setExtraStartDates((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    // w-full forces the form to always occupy the full max-w-xl of its
    // parent, regardless of its children's intrinsic width. Without this,
    // a flex-col form sizes to its max-content — so when wider conditional
    // sections appeared/disappeared (Weekdays chips, long typed names),
    // the form's width changed and mx-auto centering shifted it sideways.
    <form
      action={formAction}
      onKeyDown={(e) => {
        // Don't let Enter inside an input submit the form. Only the
        // explicit "Add Activity" button should submit. Textareas keep
        // their normal newline behavior; the submit button still
        // activates on Enter when focused.
        const target = e.target as HTMLElement;
        if (
          e.key === "Enter" &&
          target.tagName !== "TEXTAREA" &&
          target.tagName !== "BUTTON"
        ) {
          e.preventDefault();
        }
      }}
      className="flex w-full max-w-full min-w-0 flex-col gap-6"
    >
      {/* --- 1. Activity (name) ---------------------------------------- */}
      <FieldLabel label="Activity">
        <input
          type="text"
          name="name"
          required
          maxLength={120}
          placeholder="Morning run"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClasses}
        />
      </FieldLabel>

      {/* --- 2. Notes and Tags ----------------------------------------- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Notes and Tags</legend>
        <textarea
          name="notes"
          rows={2}
          maxLength={500}
          placeholder="Notes, links, sub-steps…"
          className={`${inputClasses} resize-none`}
        />
        <input
          type="text"
          name="tags"
          maxLength={300}
          placeholder="Tags, comma-separated (e.g. fitness, strength, outdoor)"
          className={inputClasses}
        />
      </fieldset>

      {/* --- 3. Rhythm ------------------------------------------------- */}
      {/* Hidden input mirrors React state for FormData. The visible
          controls below are buttons (not native <input type=radio>) because
          iOS Safari has been unreliable about firing onChange when a label-
          wrapped radio gets tapped, so the conditional rhythm config wasn't
          appearing on phones. Buttons + state-driven highlight always work. */}
      <input type="hidden" name="rhythmType" value={rhythmKind} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Rhythm</legend>
        <RhythmRadio value="single" current={rhythmKind} onChange={setRhythmKind} label="Once" />
        <RhythmRadio
          value="selection"
          current={rhythmKind}
          onChange={setRhythmKind}
          label="Unrhythmic Selection"
          hint="Several one-offs, shared details"
        />
        <RhythmRadio
          value="multi_daily"
          current={rhythmKind}
          onChange={setRhythmKind}
          label="Multi-Daily"
          hint="Specific times every day"
        />
        <RhythmRadio value="daily" current={rhythmKind} onChange={setRhythmKind} label="Daily" />
        <RhythmRadio
          value="weekdays"
          current={rhythmKind}
          onChange={setRhythmKind}
          label="Specific Days of the Week"
        />
        <RhythmRadio
          value="interval"
          current={rhythmKind}
          onChange={setRhythmKind}
          label="Every N Days"
        />
        <RhythmRadio
          value="frequency"
          current={rhythmKind}
          onChange={setRhythmKind}
          label="N times per period"
        />
      </fieldset>

      {/* Conditional rhythm config */}
      {isMultiDaily && (
        <ConfigBox column>
          <p className="text-xs text-zinc-500">
            Specify each time of day. Add or remove rows as needed.
          </p>
          <ul className="flex flex-col gap-2">
            {multiDailyTimes.map((t, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  type="time"
                  name="scheduledTime"
                  value={t}
                  onChange={(e) => updateMultiDailyTime(i, e.target.value)}
                  required
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
                <button
                  type="button"
                  onClick={() => removeMultiDailyTime(i)}
                  disabled={multiDailyTimes.length === 1}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={addMultiDailyTime}
            className="self-start rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            + Add time
          </button>
        </ConfigBox>
      )}

      {rhythmKind === "weekdays" && (
        <ConfigBox column>
          <p className="text-xs text-zinc-500">Pick at least one.</p>
          {/* Hidden inputs mirror state for FormData (server reads getAll("weekday")). */}
          {weekdays.map((day) => (
            <input key={day} type="hidden" name="weekday" value={day} />
          ))}
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => {
              const selected = weekdays.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleWeekday(d.value)}
                  className={`touch-manipulation rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    selected
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                      : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </ConfigBox>
      )}

      {rhythmKind === "interval" && (
        <ConfigBox>
          <span className="text-sm">Every</span>
          <input
            type="number"
            name="intervalDays"
            min={1}
            max={365}
            value={intervalDaysStr}
            onChange={(e) => setIntervalDaysStr(e.target.value)}
            onBlur={(e) => {
              // Snap back to a valid number when the user leaves the field.
              const n = parseInt(e.target.value, 10);
              setIntervalDaysStr(
                Number.isFinite(n) && n >= 1 ? String(Math.min(n, 365)) : "1"
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
        </ConfigBox>
      )}

      {rhythmKind === "frequency" && (
        <ConfigBox>
          <input
            type="number"
            name="frequencyCount"
            min={1}
            max={99}
            value={frequencyCountStr}
            onChange={(e) => setFrequencyCountStr(e.target.value)}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              setFrequencyCountStr(
                Number.isFinite(n) && n >= 1 ? String(Math.min(n, 99)) : "1"
              );
            }}
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
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              setFrequencyPerCountStr(
                Number.isFinite(n) && n >= 1 ? String(Math.min(n, 99)) : "1"
              );
            }}
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
            <option value="days">{frequencyPerCount === 1 ? "day" : "days"}</option>
            <option value="weeks">{frequencyPerCount === 1 ? "week" : "weeks"}</option>
            <option value="months">{frequencyPerCount === 1 ? "month" : "months"}</option>
          </select>
        </ConfigBox>
      )}

      {/* --- 4. Schedule ----------------------------------------------- */}
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Schedule</legend>
        <div className="grid grid-cols-2 gap-3">
          <FieldLabel label="Start date">
            <input
              type="date"
              name="startDate"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputClasses}
            />
          </FieldLabel>
          <FieldLabel
            label={
              <>
                End date{" "}
                <span className="font-normal text-zinc-500">
                  {isSingleLike ? "(n/a)" : "(optional)"}
                </span>
              </>
            }
          >
            <input
              type="date"
              name="endDate"
              value={isSingleLike ? "" : endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={isSingleLike}
              className={inputClasses}
            />
          </FieldLabel>
        </div>

        {/* Selection mode: list of extra dates, each producing its own
            single activity. Submitted as additional `startDate` form
            values; the server splits them in createActivity. */}
        {isSelection && (
          <ConfigBox column>
            <p className="text-xs text-zinc-500">
              Each additional date becomes a separate one-time activity
              sharing the name, notes, tags, time, priority, and reminders
              above.
            </p>
            {extraStartDates.length > 0 && (
              <ul className="flex flex-col gap-2">
                {extraStartDates.map((d, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <input
                      type="date"
                      name="startDate"
                      value={d}
                      onChange={(e) => updateExtraStartDate(i, e.target.value)}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <button
                      type="button"
                      onClick={() => removeExtraStartDate(i)}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={addExtraStartDate}
              className="self-start rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              + Add date
            </button>
          </ConfigBox>
        )}

        {!isMultiDaily && (
          <FieldLabel
            label={
              <>
                Time of day{" "}
                <span className="font-normal text-zinc-500">(optional)</span>
              </>
            }
          >
            <input type="time" name="scheduledTime" className={inputClasses} />
          </FieldLabel>
        )}

        {!isSingleLike && !isMultiDaily && (
          <p className="text-xs text-zinc-500">
            Leave end date blank for an open-ended rhythm.
          </p>
        )}
      </fieldset>

      {/* --- 5. Priority (only for Once / Selection) ------------------- */}
      {isSingleLike && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Priority</legend>
          <div className="flex gap-2">
            <PriorityRadio value="1" label="High" />
            <PriorityRadio value="2" label="Medium" defaultChecked />
            <PriorityRadio value="3" label="Low" />
          </div>
        </fieldset>
      )}

      {/* --- 6. Reminders ---------------------------------------------- */}
      <RemindersField reminders={reminders} setReminders={setReminders} />

      {/* --- Calendar preview ------------------------------------------ */}
      <CalendarPreview
        rhythm={previewRhythm}
        startDate={startDate}
        endDate={effectiveEndDate}
        activityName={name}
        reminders={reminders}
      />

      {/* Error */}
      {state && "error" in state && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="mt-1 self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Adding…" : "Add Activity"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Derive a valid Rhythm object from current form state, or null if the
// shape isn't complete enough yet (e.g. weekdays with no day selected).
// ---------------------------------------------------------------------------

function derivePreviewRhythm({
  kind,
  weekdays,
  intervalDays,
  frequencyCount,
  frequencyPerCount,
  frequencyPerUnit,
  multiDailyTimes,
}: {
  kind: RhythmKind;
  weekdays: DayOfWeek[];
  intervalDays: number;
  frequencyCount: number;
  frequencyPerCount: number;
  frequencyPerUnit: PeriodUnit;
  multiDailyTimes: string[];
}): Rhythm | null {
  switch (kind) {
    case "single":
    case "selection":
      // Selection fans out to multiple `single` activities server-side;
      // for the calendar preview we just show the primary date's single.
      return { type: "single" };
    case "daily":
      return { type: "daily" };
    case "weekdays":
      return weekdays.length === 0
        ? null
        : { type: "weekdays", days: weekdays };
    case "interval":
      return intervalDays >= 1
        ? { type: "interval", days: intervalDays }
        : null;
    case "frequency":
      return frequencyCount >= 1
        ? {
            type: "frequency",
            count: frequencyCount,
            perCount: frequencyPerCount,
            perUnit: frequencyPerUnit,
          }
        : null;
    case "multi_daily": {
      const validTimes = multiDailyTimes.filter((t) =>
        /^\d{2}:\d{2}$/.test(t)
      );
      return validTimes.length === 0
        ? null
        : {
            type: "frequency",
            count: validTimes.length,
            perCount: 1,
            perUnit: "days",
          };
    }
  }
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

// `w-full` so inputs always stretch to the form's max width.
// `min-w-0` is critical — inputs have an intrinsic min-width based on
// their `size` attribute or content; without min-w-0 they can refuse to
// shrink and push the parent wider.
const inputClasses =
  "w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50 dark:disabled:bg-zinc-950";

function FieldLabel({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  // min-w-0 so this label, when nested in a grid (e.g. the 2-col Schedule
  // section), can shrink below its content's intrinsic width instead of
  // forcing the grid to widen.
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function RhythmRadio({
  value,
  current,
  onChange,
  label,
  hint,
}: {
  value: RhythmKind;
  current: RhythmKind;
  onChange: (v: RhythmKind) => void;
  label: string;
  hint?: string;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`flex w-full touch-manipulation items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
        selected
          ? "border-zinc-900 bg-zinc-100 dark:border-zinc-50 dark:bg-zinc-900"
          : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      }`}
    >
      <span className="flex items-center gap-2">
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
        <span>{label}</span>
      </span>
      {hint && (
        <span className="text-xs font-normal text-zinc-500">{hint}</span>
      )}
    </button>
  );
}

function ConfigBox({
  children,
  column = false,
}: {
  children: React.ReactNode;
  column?: boolean;
}) {
  return (
    <div
      className={`flex w-full min-w-0 ${
        column ? "flex-col" : "flex-wrap items-center"
      } gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800`}
    >
      {children}
    </div>
  );
}

function PriorityRadio({
  value,
  label,
  defaultChecked = false,
}: {
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  // Native radio kept (just visually hidden) so FormData picks up the value
  // without needing extra React state for this 1-of-3 choice. The visible
  // button beside it is what receives taps reliably on iOS.
  return (
    <label className="relative flex-1 cursor-pointer">
      <input
        type="radio"
        name="priority"
        value={value}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <span className="block touch-manipulation rounded-md border border-zinc-300 px-3 py-2 text-center text-sm font-medium peer-checked:border-zinc-900 peer-checked:bg-zinc-900 peer-checked:text-white dark:border-zinc-700 dark:peer-checked:border-zinc-50 dark:peer-checked:bg-zinc-50 dark:peer-checked:text-zinc-900">
        {label}
      </span>
    </label>
  );
}
