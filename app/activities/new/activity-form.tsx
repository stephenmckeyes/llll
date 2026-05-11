"use client";

// ---------------------------------------------------------------------------
// Unified Add-Activity form.
//
// Section layout (matches user spec):
//   1. Activity (name)
//   2. Notes and Tags  (notes textarea + comma-separated tags input)
//   3. Rhythm          (6 radio options + conditional config)
//   4. Schedule        (start_date + end_date; end disabled for "Once")
//   5. Priority        (radio, only shown for "Once" per the design)
//
// Phase 2 will add: time-of-day input, reminders, calendar preview.
// Phase 1 stores priority as 2 (medium) for non-single activities by
// default since the field isn't shown.
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

export function ActivityForm() {
  const [state, formAction, isPending] = useActionState<
    ActivityFormState,
    FormData
  >(createActivity, null);
  const [rhythm, setRhythm] = useState<RhythmKind>("single");

  const isSingle = rhythm === "single";

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

        <RhythmRadio
          value="single"
          current={rhythm}
          onChange={setRhythm}
          label="Once"
        />
        <RhythmRadio
          value="multi_daily"
          current={rhythm}
          onChange={setRhythm}
          label="Multi-Daily"
          hint="A few times every day"
        />
        <RhythmRadio
          value="daily"
          current={rhythm}
          onChange={setRhythm}
          label="Daily"
        />
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
      {rhythm === "multi_daily" && (
        <ConfigBox>
          <input
            type="number"
            name="multiDailyCount"
            min={1}
            max={50}
            defaultValue={2}
            className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="text-sm">times per day.</span>
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
        {!isSingle && (
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
