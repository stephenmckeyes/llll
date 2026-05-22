// ---------------------------------------------------------------------------
// /friends/[friendId] — a read-only window into ONE friend's shared rhythms,
// with Total / Calendar / Grid sub-views (see FriendView). Replaces the old
// "Shared with me" list: you reach it from the View button on the Friends
// page. You can browse and copy, never edit — the data comes only from the
// SECURITY DEFINER RPCs that return what this friend shared with you.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";

import { getSocialOverview } from "@/app/actions/friends";
import {
  getSharedInstancesWithMe,
  getSharedWithMe,
} from "@/app/actions/sharing";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import { buildTagMap, computeTagUsage } from "@/lib/domain/tags";

import { PendingLink } from "@/app/_components/pending-link";

import { FriendView } from "./friend-view";

function todayInTimeZone(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export default async function FriendViewPage({
  params,
}: {
  params: Promise<{ friendId: string }>;
}) {
  const { friendId } = await params;
  const { supabase, profile } = await requireOnboardedUser();

  // Confirm an ACCEPTED friendship (and get the display name). Anyone who
  // isn't an accepted friend gets bounced — the RPCs would return nothing
  // anyway, but this keeps the URL from being a fishing tool.
  const overview = await getSocialOverview();
  const friend = overview.find(
    (e) => e.status === "accepted" && e.otherId === friendId
  );
  if (!friend) redirect("/friends");
  const friendName =
    friend.otherDisplayName ||
    (friend.otherUsername ? `@${friend.otherUsername}` : "Your friend");

  const todayStr = todayInTimeZone(profile.timezone ?? "UTC");
  const from = addDaysToYmd(todayStr, -35);
  const to = addDaysToYmd(todayStr, 35);

  const [allShares, allInstances, { data: tagRows }, { data: activityTagRows }] =
    await Promise.all([
      getSharedWithMe(),
      getSharedInstancesWithMe(from, to),
      supabase.from("tags").select("id, name, color"),
      supabase
        .from("activities")
        .select("default_skill_tags")
        .is("archived_at", null),
    ]);

  const shares = allShares.filter((s) => s.ownerId === friendId);
  const instances = allInstances.filter((i) => i.ownerId === friendId);

  // Tag palette is the CURRENT user's (the Copy form creates your own
  // activity, so it picks from your tags — mirrors /activities/new).
  const usageByName = computeTagUsage(
    (activityTagRows ?? []) as Array<{ default_skill_tags: string[] | null }>
  );
  const tagMap = buildTagMap(
    (tagRows ?? []) as Array<{ id: string; name: string; color: string }>,
    usageByName
  );

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 bg-white p-6 dark:bg-zinc-950">
      <header className="flex flex-col gap-1">
        <PendingLink
          href="/friends"
          className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Friends
        </PendingLink>
        <h1 className="text-3xl font-semibold tracking-tight">{friendName}</h1>
        <p className="text-sm text-zinc-500">Shared with you · view &amp; copy only</p>
      </header>

      <FriendView
        friendName={friendName}
        shares={shares}
        instances={instances}
        todayStr={todayStr}
        tagMap={tagMap}
      />
    </main>
  );
}
