"use client";

// ---------------------------------------------------------------------------
// FeedbackForm — pick Bug vs Idea, write a message, send. On success the
// textarea clears and a confirmation shows. The destination address is never
// shown (it lives server-side in the action).
// ---------------------------------------------------------------------------

import { useActionState, useEffect, useRef, useState } from "react";

import { submitFeedback, type FeedbackState } from "@/app/actions/feedback";

const inputClasses =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50";

export function FeedbackForm() {
  const [type, setType] = useState<"bug" | "idea">("bug");
  const [state, formAction, isPending] = useActionState<FeedbackState, FormData>(
    submitFeedback,
    null
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form after a successful send.
  useEffect(() => {
    if (state && "ok" in state) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="type" value={type} />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">What is this?</legend>
        <div className="flex gap-2">
          {(
            [
              ["bug", "Bug report"],
              ["idea", "Idea / improvement"],
            ] as const
          ).map(([val, label]) => {
            const active = type === val;
            return (
              <button
                key={val}
                type="button"
                onClick={() => setType(val)}
                className={`flex-1 touch-manipulation rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  active
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

      <label className="block">
        <span className="text-sm font-medium">
          {type === "bug"
            ? "What went wrong? (steps to reproduce help!)"
            : "What would make Mission better?"}
        </span>
        <textarea
          name="message"
          rows={6}
          required
          maxLength={4000}
          placeholder={
            type === "bug"
              ? "When I tap … on the … view, it …"
              : "It would be great if …"
          }
          className={`${inputClasses} mt-1 resize-y`}
        />
      </label>

      {state && "error" in state && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}
      {state && "ok" in state && (
        <p
          role="status"
          className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        >
          Thanks! Your {type === "bug" ? "report" : "idea"} was sent.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Sending…" : "Send feedback"}
      </button>
    </form>
  );
}
