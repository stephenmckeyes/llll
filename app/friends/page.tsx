// ---------------------------------------------------------------------------
// /friends — find people, manage friend requests, see your friends list.
//
// Incoming requests live on /notifications (accept/decline there), but we
// surface a count + link here too. Sharing rhythms with friends builds on
// this page in a follow-up.
// ---------------------------------------------------------------------------

import Link from "next/link";

import { getSocialOverview, type SocialEntry } from "@/app/actions/friends";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { PendingLink } from "@/app/_components/pending-link";

import { FriendRowButton, FriendSearch } from "./friends-client";
import { ShareRhythmsButton } from "./share-modal";

function nameOf(e: SocialEntry): string {
  return e.otherDisplayName || (e.otherUsername ? `@${e.otherUsername}` : "Someone");
}

export default async function FriendsPage() {
  await requireOnboardedUser();
  const entries = await getSocialOverview();

  const friends = entries.filter((e) => e.status === "accepted");
  const outgoing = entries.filter(
    (e) => e.status === "pending" && e.direction === "outgoing"
  );
  const incomingCount = entries.filter(
    (e) => e.status === "pending" && e.direction === "incoming"
  ).length;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-8 bg-white p-6 dark:bg-zinc-950">
      <header className="flex flex-col gap-1">
        <PendingLink
          href="/"
          className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Mission
        </PendingLink>
        <h1 className="text-3xl font-semibold tracking-tight">Friends</h1>
      </header>

      <Link
        href="/shared"
        className="inline-flex w-fit items-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Shared with me →
      </Link>

      {incomingCount > 0 && (
        <Link
          href="/notifications"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          You have {incomingCount} friend request
          {incomingCount === 1 ? "" : "s"} → review in Notifications
        </Link>
      )}

      {/* Find people */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Add a friend
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Search by username or email. (Set your own username in Settings →
          Account so friends can find you.)
        </p>
        <FriendSearch />
      </section>

      {/* Friends list */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Your friends ({friends.length})
        </h2>
        {friends.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No friends yet. Find someone above to get started.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {friends.map((f) => (
              <li
                key={f.friendshipId}
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{nameOf(f)}</p>
                  {f.otherUsername && (
                    <p className="truncate text-xs text-zinc-500">
                      @{f.otherUsername}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-2">
                  <ShareRhythmsButton
                    friendId={f.otherId}
                    friendName={nameOf(f)}
                  />
                  <FriendRowButton
                    friendshipId={f.friendshipId}
                    label="Remove"
                    confirmText={`Remove ${nameOf(f)} from your friends?`}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Sent (pending) requests */}
      {outgoing.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Sent requests ({outgoing.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {outgoing.map((f) => (
              <li
                key={f.friendshipId}
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{nameOf(f)}</p>
                  <p className="truncate text-xs text-zinc-500">Pending…</p>
                </div>
                <FriendRowButton friendshipId={f.friendshipId} label="Cancel" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
