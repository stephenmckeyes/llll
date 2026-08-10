// ---------------------------------------------------------------------------
// /friends/groups — Groups tab. Real end-to-end for phase 1: list + create
// + view. Calendar / leadership rank editor / activity auto-add land in
// follow-up phases (see BACKLOG.md → "Communities").
// ---------------------------------------------------------------------------

import { PendingLink } from "@/app/_components/pending-link";
import {
  getCommunity,
  listMyCommunities,
} from "@/app/actions/communities";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { CommunityTab } from "../_community-tab";
import { FriendsTabs } from "../_friends-tabs";

export default async function GroupsTabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOnboardedUser();
  const params = await searchParams;
  const rawId = params.id;
  const id = typeof rawId === "string" ? rawId : null;

  const communities = await listMyCommunities("group");
  // Fall back to the first community when ?id is missing or stale (the
  // client mirrors the same rule and nudges the URL to match).
  const effectiveId =
    id && communities.some((c) => c.id === id)
      ? id
      : (communities[0]?.id ?? null);
  const detail = effectiveId ? await getCommunity(effectiveId) : null;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 bg-white p-6 dark:bg-zinc-950">
      <header className="flex flex-col gap-1">
        <PendingLink
          href="/"
          className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Mission
        </PendingLink>
        <h1 className="text-3xl font-semibold tracking-tight">Friends</h1>
      </header>

      <FriendsTabs active="groups" />

      <CommunityTab kind="group" communities={communities} detail={detail} />
    </main>
  );
}
