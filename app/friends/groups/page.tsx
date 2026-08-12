// ---------------------------------------------------------------------------
// /friends/groups — Groups tab. Real end-to-end for phase 1: list + create
// + view. Calendar / leadership rank editor / activity auto-add land in
// follow-up phases (see BACKLOG.md → "Communities").
// ---------------------------------------------------------------------------

import {
  getCommunity,
  listMyCommunities,
} from "@/app/actions/communities";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { CommunityShell } from "../_community-shell";
import { CommunityTab } from "../_community-tab";

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
    <CommunityShell active="groups">
      <CommunityTab kind="group" communities={communities} detail={detail} />
    </CommunityShell>
  );
}
