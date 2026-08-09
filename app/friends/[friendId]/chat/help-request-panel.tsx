"use client";

// ---------------------------------------------------------------------------
// HelpRequestPanel — the big red rendering for `is_help_request=true`
// messages in the chat.
//
// Two audiences:
//   - RECIPIENT (mine=false): the friend is asking me to help them stay
//     on track. Big red banner with the sender's name + the activity
//     they need help with + "Check-in now" as the primary CTA, then
//     shortcut buttons that deep-link to the sender's Calendar / Grid /
//     Total views (with the activity highlighted where that's supported).
//   - SENDER (mine=true): I asked the friend for help. Same panel but
//     restyled as a subtle sent-request card ("You asked …") without
//     the urgent red — I don't need the alert; I already know.
//
// The friend-view links assume the activity IS shared with the recipient
// — sendHelpRequest auto-shares if it wasn't. Even if a share is
// revoked later, the links still route somewhere sensible: `/friends/
// [id]` renders whatever the current share state allows.
// ---------------------------------------------------------------------------

import Link from "next/link";

export function HelpRequestPanel({
  mine,
  senderName,
  friendId,
  activityId,
  activityName,
  note,
}: {
  mine: boolean;
  /** For mine=false: the friend's display name. For mine=true: any
   *  fallback (not shown). */
  senderName: string;
  /** The URL-friend for the calendar/grid/total links. Since this
   *  panel renders inside a chat that's always with ONE friend, all
   *  three links go to /friends/[friendId] regardless of who sent
   *  the message. */
  friendId: string;
  activityId: string | null;
  activityName: string | null;
  /** Optional free-text note the sender attached. */
  note: string;
}) {
  // If the activity vanished (id nulled by ON DELETE SET NULL) the panel
  // degrades to a plain message so the chat still shows what was
  // actually said.
  if (!activityId || !activityName) {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        {mine ? "You asked for help — " : `${senderName} asked for help — `}
        the activity was deleted.
        {note && (
          <p className="mt-2 whitespace-pre-wrap break-words text-zinc-700 dark:text-zinc-300">
            {note}
          </p>
        )}
      </div>
    );
  }

  const base = `/friends/${friendId}`;

  const panelClass = mine
    ? "rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
    : "rounded-md border-2 border-red-500 bg-red-50 dark:border-red-600 dark:bg-red-950";

  return (
    <div className={panelClass}>
      {mine ? (
        // Sender view — softer card so my own outbound request doesn't
        // shout at me every time I open the chat.
        <div className="p-3">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            You asked <span className="font-medium">{senderName}</span> for
            help with:{" "}
            <span className="font-semibold">{activityName}</span>
          </p>
          {note && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-600 dark:text-zinc-400">
              {note}
            </p>
          )}
        </div>
      ) : (
        // Recipient view — the alert render. Bold headline, big red
        // "Check in now" CTA, note underneath (if any).
        <div className="flex flex-col gap-3 p-4">
          <p className="text-base font-bold text-red-800 dark:text-red-200">
            {senderName} needs help accomplishing:{" "}
            <span className="underline underline-offset-2">{activityName}</span>.
          </p>
          <Link
            href={`${base}?highlight=${encodeURIComponent(activityId)}`}
            className="inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700"
          >
            Check in now
          </Link>
          {note && (
            <p className="whitespace-pre-wrap break-words rounded-md bg-white px-3 py-2 text-sm text-zinc-700 dark:bg-red-950/40 dark:text-red-100">
              {note}
            </p>
          )}
        </div>
      )}

      {/* Quick-jump links — visible for both sides so the sender can
          also open the shared views to double-check what the friend
          will see. Compact button row with a shared label. */}
      <div className="flex flex-col gap-2 border-t border-red-200 px-3 py-2 dark:border-red-900/70">
        <span className="text-[10px] font-medium uppercase tracking-wide text-red-700 dark:text-red-300">
          Quick check-in
        </span>
        <div className="flex flex-wrap gap-1">
          <QuickLink
            href={`${base}?view=calendar&highlight=${encodeURIComponent(activityId)}`}
            label="Calendar"
          />
          <QuickLink
            href={`${base}?view=grid&highlight=${encodeURIComponent(activityId)}`}
            label="Streaks"
          />
          <QuickLink
            href={`${base}?view=total&highlight=${encodeURIComponent(activityId)}`}
            label="Total"
          />
        </div>
      </div>
    </div>
  );
}

function QuickLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 dark:border-red-700 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900"
    >
      {label}
    </Link>
  );
}
