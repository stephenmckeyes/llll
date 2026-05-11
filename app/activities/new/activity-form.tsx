"use client";

// ---------------------------------------------------------------------------
// New-activity form with the full rhythm picker.
//
// Local React state controls which conditional fields are visible. The
// server action reads the appropriate FormData fields based on the
// chosen rhythm type — single source of truth still lives server-side.
// ---------------------------------------------------------------------------

import { useActionState, useState } from "react";

import {
  createActivity,
  type ActivityFormState,
} from "@/app/actions/activities";

type RhythmType = "daily" | "weekdays" | "interval" | "frequency";

const WEEKDAY_OPTIONS = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
] as const;

export function ActivityForm() {
  const [state, formAction, isPending] = useActionState<
    ActivityFormState,
    FormData
  >(createActivity, null);
  const [rhythmType, setRhythmType] = useState<RhythmType>("daily");

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* Name */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Name</span>
        <input
          type="text"
          name="name"
          required
          maxLength={120}
          placeholder="Morning run"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
        />
      </label>

      {/* Description */}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">
          Description{" "}
          <span className="font-normal text-zinc-500">(optional)</span>
        </span>
        <textarea
          name="description"
          rows={2}
          maxLength={500}
          placeholder="Anything that helps you remember why."
          className="resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
        />
      </label>

      {/* Rhythm type */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Rhythm</legend>
        <RhythmRadio
          value="daily"
          checked={rhythmType === "daily"}
          onChange={setRhythmType}
          label="Every day"
        />
        <RhythmRadio
          value="weekdays"
          checked={rhythmType === "weekdays"}
          onChange={setRhythmType}
          label="Specific weekdays"
        />
        <RhythmRadio
          value="interval"
          checked={rhythmType === "interval"}
          onChange={setRhythmType}
          label="Every N days"
        />
        <RhythmRadio
          value="frequency"
          checked={rhythmType === "frequency"}
          onChange={setRhythmType}
          label="N times per period"
        />
      </fieldset>

      {/* Conditional rhythm config */}
      {rhythmType === "weekdays" && (
        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500">Pick at least one.</p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_OPTIONS.map((d) => (
              <label
                key={d.value}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1 text-sm dark:border-zinc-700"
              >
                <input type="checkbox" name="weekday" value={d.value} />
                {d.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {rhythmType === "interval" && (
        <div className="flex items-center gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
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
        </div>
      )}

      {rhythmType === "frequency" && (
        <div className="flex items-center gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
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
            <option value="day">day</option>
            <option value="week">week</option>
            <option value="month">month</option>
          </select>
        </div>
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
        {isPending ? "Creating…" : "Create activity"}
      </button>
    </form>
  );
}

function RhythmRadio({
  value,
  checked,
  onChange,
  label,
}: {
  value: RhythmType;
  checked: boolean;
  onChange: (v: RhythmType) => void;
  label: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="radio"
        name="rhythmType"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />
      {label}
    </label>
  );
}
