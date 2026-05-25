// ---------------------------------------------------------------------------
// /friends/[friendId]/chat — a 1:1 chat with a friend. Loads the thread
// (and marks their messages read), then hands off to the client ChatThread
// for the live list + composer.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";

import { getSocialOverview } from "@/app/actions/friends";
import { getConversation } from "@/app/actions/messages";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { PendingLink } from "@/app/_components/pending-link";

import { ChatThread } from "./chat-thread";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ friendId: string }>;
}) {
  const { friendId } = await params;
  const { user } = await requireOnboardedUser();

  const overview = await getSocialOverview();
  const friend = overview.find(
    (e) => e.status === "accepted" && e.otherId === friendId
  );
  if (!friend) redirect("/friends");
  const friendName =
    friend.otherDisplayName ||
    (friend.otherUsername ? `@${friend.otherUsername}` : "Your friend");

  const messages = await getConversation(friendId);

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
      />
    </main>
  );
}
