"use client";

// ---------------------------------------------------------------------------
// HelpRequestPanel — the panel rendering used for BOTH is_help_request=true
// (Ask-for-help, red urgent variant) and is_share_notification=true
// (a friend shared an activity with me, neutral variant). Same layout,
// same quick-check-in links, different visual weight and headline.
//
// Audiences:
//   - RECIPIENT (mine=false):
//       help  → big red banner + "Check in now" CTA
//       share → neutral card: "NAME shared: ACTIVITY" + primary
//               "Open shared rhythm" link
//     Quick check-in row (Calendar / Streaks / Total) is shown for both.
//   - SENDER (mine=true): subtle sent-request card ("You asked …" /
//     "You shared …") — no CTA, quick-links hidden (nothing new for me).
//
// The friend-view links assume the activity IS shared with the recipient
// — sendHelpRequest auto-shares if it wasn't, and shareActivity is the
// share itself, so both paths pass through here with a live share.
// ---------------------------------------------------------------------------

import Link from "next/link";

export type HelpPanelKind = "help" | "share";

export function HelpRequestPanel({
  kind = "help",
  mine,
  senderName,
  friendId,
  activityId,
  activityName,
  note,
}: {
  kind?: HelpPanelKind;
  mine: boolean;
  senderName: string;
  friendId: string;
  activityId: string | null;
  activityName: string | null;
  /** Optional free-text note the sender attached. share notifications
   *  don't carry one; help requests may or may not. */
  note: string;
}) {
  // If the activity vanished (id nulled by ON DELETE SET NULL) the panel
  // degrades to a plain line so the chat still shows what was said.
  if (!activityId || !activityName) {
    const label =
      kind === "share"
        ? mine
          ? "You shared an activity — "
          : `${senderName} shared an activity — `
        : mine
          ? "You asked for help — "
          : `${senderName} asked for help — `;
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        {label}
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
  const isHelp = kind === "help";

  // Style tokens differ per kind. Share notifications use the neutral
  // zinc palette; help requests keep the loud red urgency.
  const panelClass = mine
    ? "rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
    : isHelp
      ? "rounded-md border-2 border-red-500 bg-red-50 dark:border-red-600 dark:bg-red-950"
      : "rounded-md border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950";

  const quickBorder = isHelp
    ? "border-red-200 dark:border-red-900/70"
    : "border-zinc-200 dark:border-zinc-800";
  const quickLabelText = isHelp
    ? "text-red-700 dark:text-red-300"
    : "text-zinc-500 dark:text-zinc-400";

  return (
    <div className={panelClass}>
      {mine ? (
        // Sender view — softer card so my own outbound message doesn't
        // shout at me every time I open the chat. Same for both kinds.
        <div className="p-3">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {isHelp ? (
              <>
                You asked <span className="font-medium">{senderName}</span> for
                help with:{" "}
              </>
            ) : (
              <>
                You shared with <span className="font-medium">{senderName}</span>
                :{" "}
              </>
            )}
            <span className="font-semibold">{activityName}</span>
          </p>
          {note && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-600 dark:text-zinc-400">
              {note}
            </p>
          )}
        </div>
      ) : isHelp ? (
        // Recipient view — help request. Bold headline, big red CTA.
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
      ) : (
        // Recipient view — share notification. Neutral headline, plain
        // "Open shared rhythm" primary link (no urgency).
        <div className="flex flex-col gap-3 p-4">
          <p className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {senderName} shared:{" "}
            <span className="underline underline-offset-2">{activityName}</span>
          </p>
          <Link
            href={`${base}?highlight=${encodeURIComponent(activityId)}`}
            className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Open shared rhythm
          </Link>
        </div>
      )}

      {/* Quick-jump links — recipient-only (sender doesn't need them).
          Same three links (Calendar / Streaks / Total) for both kinds,
          styled to match the panel palette. */}
      {!mine && (
        <div className={`flex flex-col gap-2 border-t px-3 py-2 ${quickBorder}`}>
          <span
            className={`text-[10px] font-medium uppercase tracking-wide ${quickLabelText}`}
          >
            Quick check-in
          </span>
          <div className="flex flex-wrap gap-1">
            <QuickLink
              kind={kind}
              href={`${base}?view=calendar&highlight=${encodeURIComponent(activityId)}`}
              label="Calendar"
            />
            <QuickLink
              kind={kind}
              href={`${base}?view=grid&highlight=${encodeURIComponent(activityId)}`}
              label="Streaks"
            />
            <QuickLink
              kind={kind}
              href={`${base}?view=total&highlight=${encodeURIComponent(activityId)}`}
              label="Total"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function QuickLink({
  kind,
  href,
  label,
}: {
  kind: HelpPanelKind;
  href: string;
  label: string;
}) {
  const cls =
    kind === "help"
      ? "rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-100 dark:border-red-700 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900"
      : "rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";
  return (
    <Link href={href} className={cls}>
      {label}
    </Link>
  );
}
