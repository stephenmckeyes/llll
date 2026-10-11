// ---------------------------------------------------------------------------
// /friends/coaches/[coachId]/chat — 1:1 chat between a coach and a client
// (migration 0073). The [coachId] segment is the OTHER participant's id (works
// whether the viewer is the coach or the client). Guarded by an existing
// coaching relationship; reuses the shared ChatThread + `messages` machinery.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";

import { getCoachingCounterparty } from "@/app/actions/coaches";
import { getConversation } from "@/app/actions/messages";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { PendingLink } from "@/app/_components/pending-link";
import { ChatThread } from "@/app/friends/[friendId]/chat/chat-thread";

export default async function CoachChatPage({
  params,
}: {
  params: Promise<{ coachId: string }>;
}) {
  const { coachId } = await params;
  const { user } = await requireOnboardedUser();

  const party = await getCoachingCounterparty(coachId);
  if (!party) redirect("/friends/coaches");

  const messages = await getConversation(coachId);

  return (
    <main className="mx-auto flex h-full w-full max-w-2xl flex-col bg-white p-4 dark:bg-zinc-950">
      <header className="flex shrink-0 flex-col gap-1 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <PendingLink
          href="/friends/coaches"
          className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Coaches
        </PendingLink>
        <h1 className="text-xl font-semibold tracking-tight">
          {party.name}
          <span className="ml-2 align-middle text-xs font-normal text-zinc-500">
            {party.iAmCoach ? "your client" : "your coach"}
            {party.status === "ended" ? " · ended" : ""}
          </span>
        </h1>
      </header>

      <ChatThread
        friendId={coachId}
        friendName={party.name}
        currentUserId={user.id}
        messages={messages}
        sharedById={{}}
        watchMap={{}}
        tagMap={{}}
      />
    </main>
  );
}
