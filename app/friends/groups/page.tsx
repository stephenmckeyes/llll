// ---------------------------------------------------------------------------
// /friends/groups — Groups tab (placeholder).
//
// The tab strip is real; the tab body is a coming-soon shell. Full spec
// lives in BACKLOG.md → "Communities (Groups / Clubs / Guilds)".
// ---------------------------------------------------------------------------

import { PendingLink } from "@/app/_components/pending-link";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { CommunityPlaceholder } from "../_community-placeholder";
import { FriendsTabs } from "../_friends-tabs";

export default async function GroupsTabPage() {
  await requireOnboardedUser();
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

      <CommunityPlaceholder
        title="Groups"
        tagline="Private circles of friends · invite / request only"
        whatItIs={
          <p>
            Groups are <strong>private</strong>. They don&rsquo;t show up in
            public search — you find one via a special search / share
            link, and joining always goes through a request that the
            group has to approve, or a direct invite from a member.
          </p>
        }
        planned={[
          "Dropdown to pick which of YOUR groups you're viewing (you can be in many).",
          "Create-group modal (+ New) — name, description, invite policy.",
          "Overall page per group: members, activity feed, shared rhythms.",
          "Group calendar — members can add its activities to their own calendar, or turn on auto-add so new group activities appear automatically.",
          "Leadership settings: leader + co-leaders can grant ranks with per-permission powers (invite, approve requests, add activities, edit settings, kick).",
          "Discovery is intentionally NOT public — search requires the group's exact handle or an invite link.",
        ]}
      />
    </main>
  );
}
