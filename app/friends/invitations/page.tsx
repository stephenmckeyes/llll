// ---------------------------------------------------------------------------
// /friends/invitations — Community → Invitations tab (migration 0084).
//
// Invitations are activities a person or a community posts to invite friends,
// a community's members, nearby people, or anyone to join them. Viewers filter
// what's available to them and add an invitation to their own calendar (with
// reminders). Location-gated ("Nearby") invitations need the viewer's browser
// location, which the client requests on demand and re-queries with — it's
// never stored.
// ---------------------------------------------------------------------------

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import {
  getAvailableInvitations,
  getMyInvitationCommunities,
} from "@/app/actions/invitations";
import { buildTagMap } from "@/lib/domain/tags";

import { CommunityShell } from "../_community-shell";
import { InvitationsTab } from "./invitations-tab";

export default async function InvitationsPage() {
  const { supabase, user } = await requireOnboardedUser();

  const [invitations, communities, { data: tagRows }] = await Promise.all([
    getAvailableInvitations(null),
    getMyInvitationCommunities(),
    supabase.from("tags").select("id, name, color").is("archived_at", null),
  ]);

  const tagMap = buildTagMap(
    (tagRows ?? []) as Array<{ id: string; name: string; color: string }>
  );

  return (
    <CommunityShell active="invitations">
      <InvitationsTab
        viewerId={user.id}
        initialInvitations={invitations}
        communities={communities}
        tagMap={tagMap}
      />
    </CommunityShell>
  );
}
