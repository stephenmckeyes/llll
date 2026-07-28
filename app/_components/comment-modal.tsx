"use client";

// ---------------------------------------------------------------------------
// CommentModal — quick textarea over an activity_instance's `comment`
// column. Opened by the "Comment" button that sits next to Unlabel on the
// row's resolved state, on the Completed/Missed dropdown rows, and inside
// the full ActivityModal.
//
// One comment per occurrence (per instance), shared with any friend who
// has share_progress on the parent activity — see migration 0020.
//
// Semantics vs. other note fields:
//   - activities.notes        → the rhythm's defaults (never per-occurrence)
//   - activity_instances.notes → per-occurrence override for the modal's
//                                Edit form (name / notes / priority)
//   - activity_instances.comment → THIS: a reflection written AFTER doing
//                                  (or missing) the occurrence
//
// The empty-string case clears the comment (server-side stores NULL).
// ---------------------------------------------------------------------------

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { updateInstanceComment } from "@/app/actions/activities";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

const MAX_LEN = 2000;

export function CommentModal({
  instanceId,
  activityName,
  initialComment,
  onClose,
}: {
  instanceId: string;
  activityName: string;
  initialComment: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialComment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useBodyScrollLock();

  // Autofocus so the user can start typing immediately. Placed on
  // the end so the cursor sits after any existing text.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateInstanceComment(instanceId, value);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  const dirty = (initialComment ?? "") !== value;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="comment-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2
              id="comment-title"
              className="truncate text-lg font-semibold tracking-tight"
            >
              Comment
            </h2>
            <p className="truncate text-xs text-zinc-500">
              {activityName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        <div className="flex flex-col gap-2 px-5 py-4">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            maxLength={MAX_LEN}
            rows={5}
            placeholder="Reflect on this one — how it went, what to change next time, anything to remember…"
            className="w-full min-w-0 resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
          />
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span>
              Visible to anyone this activity is shared with.
            </span>
            <span
              className={
                value.length > MAX_LEN * 0.9
                  ? "font-medium text-amber-600 dark:text-amber-400"
                  : ""
              }
            >
              {value.length}/{MAX_LEN}
            </span>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
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
            onClick={save}
            disabled={isPending || !dirty}
            className="flex-1 touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
