// ---------------------------------------------------------------------------
// /friends/guilds — Guilds tab. Real end-to-end for phase 1: list + create
// + view. Guild-specific skill/adventure tracks land in a follow-up phase
// (see BACKLOG.md → "Communities" → guild_tracks).
// ---------------------------------------------------------------------------

import {
  getCommunity,
  listMyCommunities,
} from "@/app/actions/communities";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { CommunityShell } from "../_community-shell";
import { CommunityTab } from "../_community-tab";

export default async function GuildsTabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOnboardedUser();
  const params = await searchParams;
  const rawId = params.id;
  const id = typeof rawId === "string" ? rawId : null;

  const communities = await listMyCommunities("guild");
  const effectiveId =
    id && communities.some((c) => c.id === id)
      ? id
      : (communities[0]?.id ?? null);
  const detail = effectiveId ? await getCommunity(effectiveId) : null;

  return (
    <CommunityShell active="guilds">
      <CommunityTab kind="guild" communities={communities} detail={detail} />
    </CommunityShell>
  );
}
