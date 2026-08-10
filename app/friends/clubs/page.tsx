// ---------------------------------------------------------------------------
// /friends/clubs — Clubs tab (placeholder).
//
// The tab strip is real; the tab body is a coming-soon shell. Full spec
// lives in BACKLOG.md → "Communities (Groups / Clubs / Guilds)".
// ---------------------------------------------------------------------------

import { PendingLink } from "@/app/_components/pending-link";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { CommunityPlaceholder } from "../_community-placeholder";
import { FriendsTabs } from "../_friends-tabs";

export default async function ClubsTabPage() {
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

      <FriendsTabs active="clubs" />

      <CommunityPlaceholder
        title="Clubs"
        tagline="Publicly discoverable · join policy set by leadership"
        whatItIs={
          <p>
            Clubs are <strong>publicly findable</strong>. Leadership picks
            how much information outsiders can see (name only, member
            count, full activity feed) and whether the join is{" "}
            <strong>open</strong>, <strong>application</strong>, or{" "}
            <strong>invite-only</strong>.
          </p>
        }
        planned={[
          "Dropdown to pick which of YOUR clubs you're viewing (you can be in many).",
          "Create-club modal (+ New) — name, description, visibility, join policy.",
          "Overall page per club: members, activity feed, shared rhythms.",
          "Club calendar — members can add its activities to their own calendar or turn on auto-add.",
          "Leadership settings: leader + co-leaders assign ranks with per-permission powers (approve applications, invite, add activities, edit visibility, kick).",
          "Public search page across all clubs — filter by tag / activity type / size.",
          "Application flow: applicant writes a short note, leadership approves / declines.",
        ]}
      />
    </main>
  );
}
