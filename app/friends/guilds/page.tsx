// ---------------------------------------------------------------------------
// /friends/guilds — Guilds tab (placeholder).
//
// The tab strip is real; the tab body is a coming-soon shell. Full spec
// lives in BACKLOG.md → "Communities (Groups / Clubs / Guilds)".
// ---------------------------------------------------------------------------

import { PendingLink } from "@/app/_components/pending-link";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { CommunityPlaceholder } from "../_community-placeholder";
import { FriendsTabs } from "../_friends-tabs";

export default async function GuildsTabPage() {
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

      <FriendsTabs active="guilds" />

      <CommunityPlaceholder
        title="Guilds"
        tagline="Skill + Adventure development · mentor / progression tracks"
        whatItIs={
          <p>
            Guilds exist to <strong>develop skills and adventures</strong>.
            Experienced members mentor newcomers through progression tracks
            — a guild pairs its shared activities with structured
            skill-level or adventure-tier advancement so a new member has a
            visible path to follow.
          </p>
        }
        planned={[
          "Dropdown to pick which of YOUR guilds you're viewing (you can be in many).",
          "Create-guild modal (+ New) — name, description, skill focus, join policy.",
          "Overall page per guild: members, activity feed, skill tracks / adventures.",
          "Guild calendar — members can add its activities or turn on auto-add.",
          "Skill / Adventure tracks: leadership defines tiers; members progress through logged activity + peer review.",
          "Mentor pairing: senior members opt in as mentors; newcomers can request pairing.",
          "Leadership settings: leader + co-leaders + rank-based powers (promote / demote, mint tracks, invite, admit, add activities).",
          "Blocks on the future Levels tab so guild progression feeds a member's overall Levels view.",
        ]}
      />
    </main>
  );
}
