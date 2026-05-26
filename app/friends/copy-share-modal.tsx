"use client";

// ---------------------------------------------------------------------------
// CopyShareModal — "Copy to my schedule" for a rhythm a friend shared with
// you. Reuses the shared ActivityFormFields (same form as Edit Rhythm and
// Unarchive) pre-filled from the shared activity, with a BLANK start date so
// the user picks when their own copy begins. Submitting calls createActivity
// — the copy becomes an ordinary activity the user fully owns. The owner's
// activity is never touched (friends can view + copy, never edit).
//
// Note: we copy the template only (name, notes, tags, rhythm, times,
// priority). We deliberately do NOT copy the owner's completion history or
// reminders — your copy starts fresh on a date you choose.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useTransition } from "react";

import {
  ActivityFormFields,
  type ActivityFormInitial,
} from "@/app/_components/activity-form-fields";
import { createActivity } from "@/app/actions/activities";
import type { SharedActivity } from "@/app/actions/sharing";
import type { TagMap } from "@/lib/domain/tags";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

export function CopyShareModal({
  shared,
  tagMap,
  onClose,
}: {
  shared: SharedActivity;
  tagMap: TagMap;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Map the shared activity onto the shape ActivityFormFields expects.
  // Reminders start empty — your copy gets its own.
  const initialValues: ActivityFormInitial = {
    name: shared.name,
    notes: shared.notes,
    rhythm: shared.rhythm,
    priority: shared.priority,
    scheduled_times: shared.scheduledTimes,
    default_skill_tags: shared.defaultSkillTags,
    start_date: shared.startDate,
    end_date: shared.endDate,
    reminders: [],
    track_on_grid: false,
  };

  function submit() {
    const form = formRef.current;
    if (!form) return;
    if (!form.reportValidity()) return;

    const fd = new FormData(form);
    setError(null);
    startTransition(async () => {
      try {
        // createActivity redirects to "/" on success — we won't reach the
        // line after it in that case. On validation error it returns
        // { error }.
        const result = await createActivity(null, fd);
        if (result && "error" in result) setError(result.error);
      } catch (e) {
        console.error("CopyShareModal submit failed:", e);
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="copy-share-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2
            id="copy-share-modal-title"
            className="break-words text-xl font-semibold tracking-tight"
          >
            Copy to my schedule
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
            <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Pick a <strong>Start date</strong> and tweak anything you like —
              this creates your own private copy. The original owner&rsquo;s
              activity isn&rsquo;t affected.
            </p>

            <ActivityFormFields
              initialValues={initialValues}
              blankStartDate
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
              {isPending ? "Adding…" : "Add to my schedule"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
