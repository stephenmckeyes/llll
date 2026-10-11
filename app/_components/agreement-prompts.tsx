"use client";

// ---------------------------------------------------------------------------
// Agreement prompts (migration 0077):
//   * FirstRunPopup — a dismissible intro shown the first time a user opens a
//     surface. Records the view on dismiss so it won't show again.
//   * TermsModal — a BLOCKING accept dialog for terms/disclaimers. Controlled
//     by the parent (open it when a gated action is attempted and the user
//     hasn't accepted the current version); records acceptance on confirm.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import { acknowledge } from "@/app/actions/agreements";
import { type Agreement } from "@/lib/domain/agreements";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

export function FirstRunPopup({
  agreement,
  seen,
}: {
  agreement: Agreement;
  /** Whether the user has already seen this intro (from the acks map). */
  seen: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [, startTransition] = useTransition();
  if (seen || dismissed) return null;

  function dismiss() {
    setDismissed(true);
    startTransition(async () => {
      await acknowledge(agreement.key, agreement.version);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={dismiss}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-t-2xl bg-white p-5 shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <h2 className="text-lg font-semibold tracking-tight">
          {agreement.title}
        </h2>
        <div className="flex flex-col gap-2">
          {agreement.body.map((p, i) => (
            <p key={i} className="text-sm text-zinc-600 dark:text-zinc-400">
              {p}
            </p>
          ))}
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="self-end rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

export function TermsModal({
  agreement,
  onAccept,
  onCancel,
}: {
  agreement: Agreement;
  /** Called after acceptance is recorded — proceed with the gated action. */
  onAccept: () => void;
  onCancel: () => void;
}) {
  useBodyScrollLock();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function accept() {
    setError(null);
    startTransition(async () => {
      const res = await acknowledge(agreement.key, agreement.version);
      if ("error" in res) setError(res.error);
      else onAccept();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85svh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <h2 className="text-lg font-semibold tracking-tight">
          {agreement.title}
        </h2>
        <div className="flex flex-col gap-2">
          {agreement.body.map((p, i) => (
            <p key={i} className="text-sm text-zinc-600 dark:text-zinc-400">
              {p}
            </p>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={accept}
            disabled={isPending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? "Saving…" : agreement.acceptLabel ?? "I agree"}
          </button>
        </div>
      </div>
    </div>
  );
}
