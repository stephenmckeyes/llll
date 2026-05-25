// ---------------------------------------------------------------------------
// /friends/[friendId]/chat — a 1:1 chat with a friend. Loads the thread
// (and marks their messages read), then hands off to the client ChatThread
// for the live list + composer.
//
// Also resolves any QUOTED activities the friend has shared with you (+ your
// watch state + tag palette) so a quoted message in the chat can be tapped
// to open the activity's full read-only detail.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";

import { getSocialOverview } from "@/app/actions/friends";
import { getConversation } from "@/app/actions/messages";
import { getSharedWithMe, type SharedActivity } from "@/app/actions/sharing";
import { getWatches } from "@/app/actions/watches";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import { buildTagMap, computeTagUsage } from "@/lib/domain/tags";

import { PendingLink } from "@/app/_components/pending-link";

import { ChatThread, type WatchMap } from "./chat-thread";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ friendId: string }>;
}) {
  const { friendId } = await params;
  const { supabase, user } = await requireOnboardedUser();

  const [overview, messages, shared, watches, { data: tagRows }, { data: activityTagRows }] =
    await Promise.all([
      getSocialOverview(),
      getConversation(friendId),
      getSharedWithMe(),
      getWatches(),
      supabase.from("tags").select("id, name, color"),
      supabase
        .from("activities")
        .select("default_skill_tags")
        .is("archived_at", null),
    ]);

  const friend = overview.find(
    (e) => e.status === "accepted" && e.otherId === friendId
  );
  if (!friend) redirect("/friends");
  const friendName =
    friend.otherDisplayName ||
    (friend.otherUsername ? `@${friend.otherUsername}` : "Your friend");

  // Activities (shared with me) we can open from a quote, by id.
  const sharedById: Record<string, SharedActivity> = {};
  for (const s of shared) sharedById[s.activityId] = s;

  const watchMap: WatchMap = {};
  for (const w of watches) {
    watchMap[w.activityId] = {
      notifyEach: w.notifyEach,
      notifyDaily: w.notifyDaily,
      notifyWeekly: w.notifyWeekly,
    };
  }

  const usageByName = computeTagUsage(
    (activityTagRows ?? []) as Array<{ default_skill_tags: string[] | null }>
  );
  const tagMap = buildTagMap(
    (tagRows ?? []) as Array<{ id: string; name: string; color: string }>,
    usageByName
  );

  return (
    <main className="mx-auto flex h-svh w-full max-w-2xl flex-col bg-white p-4 dark:bg-zinc-950">
      <header className="flex flex-col gap-1 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <PendingLink
          href="/friends"
          className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Friends
        </PendingLink>
        <h1 className="text-xl font-semibold tracking-tight">{friendName}</h1>
      </header>

      <ChatThread
        friendId={friendId}
        friendName={friendName}
        currentUserId={user.id}
        messages={messages}
        sharedById={sharedById}
        watchMap={watchMap}
        tagMap={tagMap}
      />
    </main>
  );
}
