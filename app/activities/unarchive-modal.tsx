"use client";

// ---------------------------------------------------------------------------
// UnarchiveModal — the dialog opened from the /activities Archived list
// when the user clicks "Unarchive" on a row.
//
// Per user spec, unarchive is NOT a one-click flip. The user gets the
// activity in an edit form with `start_date` blank so they have to pick
// a fresh one, and they choose between two outcomes:
//
//   - Add        — recover the archived row (clears archived_at, applies
//                  any edits, regenerates future instances from the new
//                  start_date).
//   - Add as new — create a brand-new activity from the form fields,
//                  leaving the archived row alone. Useful when the user
//                  wants to keep the archived activity as a "template"
//                  for similar future ones.
//
// The form fields themselves come from the shared ActivityFormFields
// component (single source of truth with EditRhythmBody). This dialog
// just wires the two-button submit bar + Cancel + outside-click close.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useTransition } from "react";

import {
  ActivityFormFields,
  type ActivityFormInitial,
} from "@/app/_components/activity-form-fields";
import {
  createActivity,
  unarchiveActivityWithEdit,
} from "@/app/actions/activities";
import type { TagMap } from "@/lib/domain/tags";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

type SubmitMode = "add" | "addAsNew";

export function UnarchiveModal({
  activity,
  tagMap,
  onClose,
}: {
  /** All fields ActivityFormFields needs, plus the row id for the
   *  unarchive path. */
  activity: ActivityFormInitial & { id: string };
  tagMap: TagMap;
  onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Escape closes (mirrors the ActivityModal behavior).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Ref-counted body scroll-lock — see lib/ui/body-scroll-lock.
  useBodyScrollLock();

  // Submit handler keyed by which button the user clicked. Both buttons
  // are type="button" so they don't fire the form's default submit; we
  // grab the FormData manually and dispatch to the right server action.
  function submit(mode: SubmitMode) {
    const form = formRef.current;
    if (!form) return;
    // Surface native HTML validation (e.g. "Start date required") before
    // we hit the server. reportValidity() also focuses the first
    // invalid field.
    if (!form.reportValidity()) return;

    const fd = new FormData(form);
    setError(null);
    startTransition(async () => {
      try {
        if (mode === "add") {
          const result = await unarchiveActivityWithEdit(
            activity.id,
            null,
            fd
          );
          if (result && "error" in result) {
            setError(result.error);
            return;
          }
          // Success: revalidatePath inside the action repaints /activities.
          onClose();
        } else {
          // createActivity redirects to "/" on success — we won't reach
          // the next line in the success case (the page navigates away).
          // On validation error it returns { error }.
          const result = await createActivity(null, fd);
          if (result && "error" in result) {
            setError(result.error);
          }
        }
      } catch (e) {
        // Surface the actual error to the user AND to DevTools — without
        // this, a failed server action would look like "the modal does
        // nothing" because startTransition catches throws silently.
        console.error("UnarchiveModal submit failed:", e);
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unarchive-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2
            id="unarchive-modal-title"
            className="break-words text-xl font-semibold tracking-tight"
          >
            Unarchive activity
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
            // Block Enter-to-submit (matches the create/edit forms) so
            // typing in a text input doesn't accidentally fire either
            // submit path.
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
              Pick a new <strong>Start date</strong>, adjust anything else, then
              choose <strong>Add</strong> to recover this activity, or{" "}
              <strong>Add as new</strong> to keep the archived copy as a
              template and create a fresh activity from your edits.
            </p>

            <ActivityFormFields
              initialValues={activity}
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

          <div className="flex flex-wrap gap-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
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
              onClick={() => submit("addAsNew")}
              disabled={isPending}
              className="flex-1 touch-manipulation rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {isPending ? "…" : "Add as new"}
            </button>
            <button
              type="button"
              onClick={() => submit("add")}
              disabled={isPending}
              className="flex-1 touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {isPending ? "Saving…" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
