"use client";

// ---------------------------------------------------------------------------
// ReplyButton — "reply" to a friend's shared activity. Opens a small composer
// that sends a message quoting that activity into your chat with them.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useState, useTransition } from "react";

import { sendMessage } from "@/app/actions/messages";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

export function ReplyButton({
  friendId,
  activityId,
  activityName,
  scheduledFor = null,
  statusLabel = null,
}: {
  friendId: string;
  activityId: string;
  activityName: string;
  /** When replying to a specific occurrence: its date + status label. */
  scheduledFor?: string | null;
  statusLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 touch-manipulation rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Reply
      </button>
      {open && (
        <ReplyModal
          friendId={friendId}
          activityName={activityName}
          activityId={activityId}
          scheduledFor={scheduledFor}
          statusLabel={statusLabel}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ReplyModal({
  friendId,
  activityId,
  activityName,
  scheduledFor,
  statusLabel,
  onClose,
}: {
  friendId: string;
  activityId: string;
  activityName: string;
  scheduledFor: string | null;
  statusLabel: string | null;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  useBodyScrollLock();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await sendMessage(friendId, body, {
        activityId,
        activityName,
        scheduledFor,
        statusLabel,
      });
      if ("error" in res) setError(res.error);
      else setSent(true);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reply-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 id="reply-modal-title" className="text-xl font-semibold tracking-tight">
            Reply
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

        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="rounded-md border-l-2 border-zinc-400 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-500 dark:bg-zinc-900">
            <span className="opacity-70">Re: </span>
            <span className="font-medium">{activityName}</span>
            {scheduledFor && (
              <span className="opacity-70">
                {" "}
                — {scheduledFor}
                {statusLabel ? ` · ${statusLabel}` : ""}
              </span>
            )}
          </div>

          {sent ? (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              Sent!{" "}
              <Link
                href={`/friends/${friendId}/chat`}
                className="font-medium underline underline-offset-2"
              >
                Open chat
              </Link>
            </p>
          ) : (
            <>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="Add a message…"
                className="w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              {error && (
                <p
                  role="alert"
                  className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
                >
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          {sent ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={isPending}
              className="w-full touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {isPending ? "Sending…" : "Send"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
