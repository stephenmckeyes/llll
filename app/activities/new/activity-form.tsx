"use client";

// ---------------------------------------------------------------------------
// Unified Add-Activity form.
//
// Section layout:
//   1. Activity (name)
//   2. Notes and Tags  (notes textarea + comma-separated tags input)
//   3. Rhythm          (6 radio options + conditional config)
//                      Multi-Daily here shows a list of N time-of-day
//                      inputs (one per occurrence), with add/remove.
//   4. Schedule        (start_date + end_date + optional single time;
//                       end disabled for Once; time hidden for Multi-Daily
//                       because times live inside the rhythm config above)
//   5. Priority        (only shown for Once)
//
// Phase 2b will add the calendar preview pane (requires lifting all form
// state into useState; deferred to avoid a big refactor in one go).
// ---------------------------------------------------------------------------

import { useActionState, useState } from "react";

import {
  createActivity,
  type ActivityFormState,
} from "@/app/actions/activities";

type RhythmKind =
  | "single"
  | "multi_daily"
  | "daily"
  | "weekdays"
  | "interval"
  | "frequency";

const WEEKDAYS = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
] as const;

const TODAY_ISO = new Date().toISOString().slice(0, 10);

// Reasonable default times for a 2x-per-day rhythm — user edits as needed.
const DEFAULT_MULTI_DAILY_TIMES = ["08:00", "18:00"];

export function ActivityForm() {
  const [state, formAction, isPending] = useActionState<
    ActivityFormState,
    FormData
  >(createActivity, null);
  const [rhythm, setRhythm] = useState<RhythmKind>("single");
  const [multiDailyTimes, setMultiDailyTimes] = useState<string[]>(
    DEFAULT_MULTI_DAILY_TIMES
  );

  const isSingle = rhythm === "single";
  const isMultiDaily = rhythm === "multi_daily";

  function updateMultiDailyTime(i: number, value: string) {
    setMultiDailyTimes((prev) => prev.map((t, idx) => (idx === i ? value : t)));
  }
  function addMultiDailyTime() {
    setMultiDailyTimes((prev) => [...prev, "12:00"]);
  }
  function removeMultiDailyTime(i: number) {
    setMultiDailyTimes((prev) =>
      prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {/* --- 1. Activity (name) ---------------------------------------- */}
      <FieldLabel label="Activity">
        <input
          type="text"
          name="name"
          required
          maxLength={120}
          placeholder="Morning run"
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
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Rhythm</legend>

        <RhythmRadio value="single" current={rhythm} onChange={setRhythm} label="Once" />
        <RhythmRadio
          value="multi_daily"
          current={rhythm}
          onChange={setRhythm}
          label="Multi-Daily"
          hint="Specific times every day"
        />
        <RhythmRadio value="daily" current={rhythm} onChange={setRhythm} label="Daily" />
        <RhythmRadio
          value="weekdays"
          current={rhythm}
          onChange={setRhythm}
          label="Specific Weekdays"
        />
        <RhythmRadio
          value="interval"
          current={rhythm}
          onChange={setRhythm}
          label="Every N Days"
        />
        <RhythmRadio
          value="frequency"
          current={rhythm}
          onChange={setRhythm}
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

      {rhythm === "weekdays" && (
        <ConfigBox column>
          <p className="text-xs text-zinc-500">Pick at least one.</p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <label
                key={d.value}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-sm dark:border-zinc-700"
              >
                <input type="checkbox" name="weekday" value={d.value} />
                {d.label}
              </label>
            ))}
          </div>
        </ConfigBox>
      )}

      {rhythm === "interval" && (
        <ConfigBox>
          <span className="text-sm">Every</span>
          <input
            type="number"
            name="intervalDays"
            min={1}
            max={365}
            defaultValue={2}
            className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="text-sm">days, counting from the last time done.</span>
        </ConfigBox>
      )}

      {rhythm === "frequency" && (
        <ConfigBox>
          <input
            type="number"
            name="frequencyCount"
            min={1}
            max={50}
            defaultValue={3}
            className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="text-sm">times per</span>
          <select
            name="frequencyPeriod"
            defaultValue="week"
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="week">week</option>
            <option value="month">month</option>
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
              defaultValue={TODAY_ISO}
              className={inputClasses}
            />
          </FieldLabel>
          <FieldLabel
            label={
              <>
                End date{" "}
                <span className="font-normal text-zinc-500">
                  {isSingle ? "(n/a for Once)" : "(optional)"}
                </span>
              </>
            }
          >
            <input
              type="date"
              name="endDate"
              disabled={isSingle}
              className={inputClasses}
            />
          </FieldLabel>
        </div>

        {/* Single time-of-day for non-Multi-Daily rhythms */}
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

        {!isSingle && !isMultiDaily && (
          <p className="text-xs text-zinc-500">
            Leave end date blank for an open-ended rhythm.
          </p>
        )}
      </fieldset>

      {/* --- 5. Priority (only for Once) ------------------------------- */}
      {isSingle && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Priority</legend>
          <div className="flex gap-2">
            <PriorityRadio value="1" label="High" />
            <PriorityRadio value="2" label="Medium" defaultChecked />
            <PriorityRadio value="3" label="Low" />
          </div>
        </fieldset>
      )}

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
// Small UI helpers
// ---------------------------------------------------------------------------

const inputClasses =
  "rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50 dark:disabled:bg-zinc-950";

function FieldLabel({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
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
  return (
    <label className="inline-flex cursor-pointer items-baseline gap-2 text-sm">
      <input
        type="radio"
        name="rhythmType"
        value={value}
        checked={current === value}
        onChange={() => onChange(value)}
      />
      <span>{label}</span>
      {hint && <span className="text-xs text-zinc-500">— {hint}</span>}
    </label>
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
      className={`flex ${
        column ? "flex-col" : "items-center"
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
  return (
    <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-sm has-[input:checked]:border-zinc-900 has-[input:checked]:bg-zinc-900 has-[input:checked]:text-white dark:border-zinc-700 dark:has-[input:checked]:border-zinc-50 dark:has-[input:checked]:bg-zinc-50 dark:has-[input:checked]:text-zinc-900">
      <input
        type="radio"
        name="priority"
        value={value}
        defaultChecked={defaultChecked}
        className="sr-only"
      />
      {label}
    </label>
  );
}
