"use client";

// ---------------------------------------------------------------------------
// Inline "name your daily habit" form. Resets the input after a successful
// submission so you can chain-add multiple.
// ---------------------------------------------------------------------------

import { useRef, useTransition } from "react";

import { createDailyActivity } from "@/app/actions/today";

export function AddActivityForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          await createDailyActivity(formData);
          formRef.current?.reset();
        })
      }
      className="flex gap-2"
    >
      <input
        type="text"
        name="name"
        required
        placeholder="Morning run, read 10 pages…"
        className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
      />
      <button
        type="submit"
        disabled={isPending}
        className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Adding…" : "Add"}
      </button>
    </form>
  );
}
