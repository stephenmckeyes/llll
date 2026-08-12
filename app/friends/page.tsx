// ---------------------------------------------------------------------------
// /friends — find people, manage friend requests, see your friends list.
//
// Incoming requests live on /notifications (accept/decline there), but we
// surface a count + link here too. Sharing rhythms with friends builds on
// this page in a follow-up.
// ---------------------------------------------------------------------------

import Link from "next/link";

import { getSocialOverview, type SocialEntry } from "@/app/actions/friends";
import { getUnreadCounts } from "@/app/actions/messages";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { AskForHelpButton } from "./ask-for-help";
import { CommunityShell } from "./_community-shell";
import { FriendRowButton, FriendSearch } from "./friends-client";
import { FriendsList } from "./friends-list";

function nameOf(e: SocialEntry): string {
  return e.otherDisplayName || (e.otherUsername ? `@${e.otherUsername}` : "Someone");
}

export default async function FriendsPage() {
  const { supabase, user } = await requireOnboardedUser();
  const [entries, unread, { data: activityRows }, { data: shareRows }] =
    await Promise.all([
      getSocialOverview(),
      getUnreadCounts(),
      supabase
        .from("activities")
        .select("id, name")
        .is("archived_at", null)
        .order("name", { ascending: true }),
      // Existing shares so the Ask-for-help modal can highlight which
      // friends will get auto-shared when they're picked.
      supabase
        .from("activity_shares")
        .select("activity_id, shared_with_id")
        .eq("owner_id", user.id),
    ]);

  const friends = entries.filter((e) => e.status === "accepted");
  const outgoing = entries.filter(
    (e) => e.status === "pending" && e.direction === "outgoing"
  );
  const incomingCount = entries.filter(
    (e) => e.status === "pending" && e.direction === "incoming"
  ).length;

  const myActivities = (
    (activityRows ?? []) as Array<{ id: string; name: string }>
  ).map((a) => ({ id: a.id, name: a.name }));
  const friendOptions = friends.map((f) => ({
    id: f.otherId,
    name: nameOf(f),
  }));

  // Build a friendId → activityId[] map from the flat share rows. The
  // Ask-for-help modal rebuilds each into a Set client-side; we can't
  // send Sets across the RSC boundary. This feeds the "N of your
  // selected friends don't have this shared yet" auto-share note.
  const sharedActivityIdsByFriendId: Record<string, string[]> = {};
  for (const s of (shareRows ?? []) as Array<{
    activity_id: string;
    shared_with_id: string;
  }>) {
    (sharedActivityIdsByFriendId[s.shared_with_id] ??= []).push(s.activity_id);
  }

  return (
    <CommunityShell active="friends">
      <AskForHelpButton
        friends={friendOptions}
        activities={myActivities}
        sharedActivityIdsByFriendId={sharedActivityIdsByFriendId}
      />

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

      {/* Friends list — client component so it can host the search
          field and the Edit-order mode without a round-trip. */}
      <section className="flex flex-col gap-3">
        <FriendsList friends={friends} unread={unread} />
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
    </CommunityShell>
  );
}
