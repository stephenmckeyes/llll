"use client";

// ---------------------------------------------------------------------------
// NewActivityModal — create an activity inline from the Day view, opened by
// the "+ Add activity" placeholder at the bottom of each day. It's the same
// field set as Edit rhythm / Unarchive (ActivityFormFields), pre-dated to
// the day you clicked, so adding "a thing for next Tuesday" is one tap from
// that day instead of a trip to /activities/new.
//
// On success createActivity redirects to "/" (the dashboard) with the new
// activity generated; on a validation error it stays open and shows it.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useTransition } from "react";

import { createActivity } from "@/app/actions/activities";
import type { TagMap } from "@/lib/domain/tags";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

import {
  ActivityFormFields,
  type ActivityFormInitial,
} from "./activity-form-fields";

function blankActivity(startDate: string): ActivityFormInitial {
  return {
    name: "",
    notes: null,
    rhythm: { type: "single" },
    priority: 2,
    scheduled_times: [],
    default_skill_tags: [],
    start_date: startDate,
    end_date: null,
    reminders: [],
  };
}

export function NewActivityModal({
  startDate,
  tagMap,
  onClose,
}: {
  /** YYYY-MM-DD the user tapped — prefills the form's Start date. */
  startDate: string;
  tagMap: TagMap;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useBodyScrollLock();

  function submit() {
    const form = formRef.current;
    if (!form) return;
    // Surface native validation (name + time required) before the server.
    if (!form.reportValidity()) return;

    const fd = new FormData(form);
    setError(null);
    startTransition(async () => {
      try {
        // createActivity redirects to "/" on success — we won't reach the
        // next line in that case. On validation error it returns { error }.
        const result = await createActivity(null, fd);
        if (result && "error" in result) setError(result.error);
      } catch (e) {
        console.error("NewActivityModal submit failed:", e);
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-activity-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2
            id="new-activity-title"
            className="break-words text-xl font-semibold tracking-tight"
          >
            Add activity
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        <form
          ref={formRef}
          onKeyDown={(e) => {
            const target = e.target as HTMLElement;
            if (
              e.key === "Enter" &&
              target.tagName !== "TEXTAREA" &&
              target.tagName !== "BUTTON"
            ) {
              e.preventDefault();
            }
          }}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <ActivityFormFields
              initialValues={blankActivity(startDate)}
              tagMap={tagMap}
            />

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
              >
                {error}
              </p>
            )}
          </div>

          <div className="flex gap-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="flex-1 touch-manipulation rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={isPending}
              className="flex-1 touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {isPending ? "Adding…" : "Add Activity"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
