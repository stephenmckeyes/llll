"use client";

// ---------------------------------------------------------------------------
// New-task form. Simpler than the activity form — no rhythm picker, just
// name + description + optional dates + priority.
// ---------------------------------------------------------------------------

import { useActionState } from "react";

import { createTask, type TaskFormState } from "@/app/actions/tasks";

export function TaskForm() {
  const [state, formAction, isPending] = useActionState<
    TaskFormState,
    FormData
  >(createTask, null);

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
          placeholder="Fix the kitchen sink"
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
          placeholder="Notes, links, sub-steps…"
          className="resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
        />
      </label>

      {/* Dates: due + earliest */}
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            Due date{" "}
            <span className="font-normal text-zinc-500">(optional)</span>
          </span>
          <input
            type="date"
            name="dueDate"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            Earliest date{" "}
            <span className="font-normal text-zinc-500">(optional)</span>
          </span>
          <input
            type="date"
            name="earliestDate"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
          />
        </label>
      </div>
      <p className="-mt-3 text-xs text-zinc-500">
        Set both for a window: &ldquo;do this between X and Y.&rdquo;
      </p>

      {/* Priority */}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Priority</legend>
        <div className="flex gap-2">
          <PriorityRadio value="1" label="High" />
          <PriorityRadio value="2" label="Medium" defaultChecked />
          <PriorityRadio value="3" label="Low" />
        </div>
      </fieldset>

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
        {isPending ? "Creating…" : "Create task"}
      </button>
    </form>
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
