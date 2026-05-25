"use client";

// ---------------------------------------------------------------------------
// AskForHelpButton — pick one of YOUR activities you're struggling with,
// choose which friends to ask, write an optional note, and send it as a
// quoted message into each chosen friend's chat.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import { sendMessage } from "@/app/actions/messages";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

type FriendOption = { id: string; name: string };
type ActivityOption = { id: string; name: string };

export function AskForHelpButton({
  friends,
  activities,
}: {
  friends: FriendOption[];
  activities: ActivityOption[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-fit items-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Ask for help
      </button>
      {open && (
        <AskForHelpModal
          friends={friends}
          activities={activities}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AskForHelpModal({
  friends,
  activities,
  onClose,
}: {
  friends: FriendOption[];
  activities: ActivityOption[];
  onClose: () => void;
}) {
  const [activityId, setActivityId] = useState<string>(
    activities[0]?.id ?? ""
  );
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  useBodyScrollLock();

  function toggleFriend(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    const activity = activities.find((a) => a.id === activityId);
    if (!activity) {
      setError("Pick an activity you'd like help with.");
      return;
    }
    if (chosen.size === 0) {
      setError("Choose at least one friend to ask.");
      return;
    }
    setError(null);
    startTransition(async () => {
      for (const friendId of chosen) {
        const res = await sendMessage(friendId, note, {
          activityId: activity.id,
          activityName: activity.name,
        });
        if ("error" in res) {
          setError(res.error);
          return;
        }
      }
      setSent(true);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ask-help-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 id="ask-help-title" className="text-xl font-semibold tracking-tight">
            Ask for help
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

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {sent ? (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              Sent! Your request is in{" "}
              {chosen.size === 1 ? "their" : "each friend's"} chat.
            </p>
          ) : activities.length === 0 ? (
            <p className="text-sm text-zinc-500">
              You don&rsquo;t have any activities yet — add one first, then you
              can ask a friend for help with it.
            </p>
          ) : friends.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Add a friend first, then you can ask them for help.
            </p>
          ) : (
            <>
              <label className="block">
                <span className="text-sm font-medium">
                  Which activity are you struggling with?
                </span>
                <select
                  value={activityId}
                  onChange={(e) => setActivityId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {activities.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-4">
                <p className="text-sm font-medium">Ask which friends?</p>
                <ul className="mt-1 flex flex-col gap-1">
                  {friends.map((f) => (
                    <li key={f.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900">
                        <input
                          type="checkbox"
                          checked={chosen.has(f.id)}
                          onChange={() => toggleFriend(f.id)}
                          className="h-4 w-4"
                        />
                        <span className="truncate">{f.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>

              <label className="mt-4 block">
                <span className="text-sm font-medium">
                  Note{" "}
                  <span className="font-normal text-zinc-500">(optional)</span>
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  placeholder="What are you finding hard? (or just send the activity)"
                  className="mt-1 w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>

              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
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
              disabled={
                isPending || activities.length === 0 || friends.length === 0
              }
              className="w-full touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {isPending ? "Sending…" : "Send request"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
