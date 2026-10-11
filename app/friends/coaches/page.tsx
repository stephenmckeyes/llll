// ---------------------------------------------------------------------------
// /friends/coaches — Coaches tab (phase 1, migration 0072).
//
// Members browse a "Find a Coach" directory of verified coaches (photo, bio,
// price, rating) and can apply to become a coach themselves. A platform admin
// reviews pending applications here. Coach↔client chat, activity sharing, the
// coach activity cache, and reviews land in later phases.
// ---------------------------------------------------------------------------

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import {
  getCoachDirectory,
  getMyClients,
  getMyCoachProfile,
  getMyCoaches,
  getPendingCoachApplications,
  isCurrentUserAdmin,
} from "@/app/actions/coaches";

import { CommunityShell } from "../_community-shell";
import { CoachesTab } from "./coaches-tab";

export default async function CoachesTabPage() {
  await requireOnboardedUser();

  const isAdmin = await isCurrentUserAdmin();
  const [directory, myProfile, pending, myCoaches, myClients] =
    await Promise.all([
      getCoachDirectory(),
      getMyCoachProfile(),
      isAdmin ? getPendingCoachApplications() : Promise.resolve([]),
      getMyCoaches(),
      getMyClients(),
    ]);

  return (
    <CommunityShell active="coaches">
      <CoachesTab
        directory={directory}
        myProfile={myProfile}
        isAdmin={isAdmin}
        pending={pending}
        myCoaches={myCoaches}
        myClients={myClients}
      />
    </CommunityShell>
  );
}
