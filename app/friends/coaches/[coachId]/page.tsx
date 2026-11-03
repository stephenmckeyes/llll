// ---------------------------------------------------------------------------
// /friends/coaches/[coachId] — a verified coach's full public profile:
// photo / bio / price / rating, all their reviews, and the plans they've
// chosen to make public (free previews). Reachable from the Find-a-Coach
// directory; engaging a coach from here goes through the same client-
// disclaimer gate as the directory.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";

import {
  getCoachPublicPlans,
  getCoachPublicProfile,
  getCoachReviews,
  getMyCoaches,
} from "@/app/actions/coaches";
import { getAcknowledgments } from "@/app/actions/agreements";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { CoachProfileView } from "./coach-profile-view";

export default async function CoachProfilePage({
  params,
}: {
  params: Promise<{ coachId: string }>;
}) {
  const { coachId } = await params;
  await requireOnboardedUser();

  const coach = await getCoachPublicProfile(coachId);
  // Not a verified / listed coach → nothing public to show.
  if (!coach) redirect("/friends/coaches/find");

  const [reviews, plans, myCoaches, acks] = await Promise.all([
    getCoachReviews(coachId),
    getCoachPublicPlans(coachId),
    getMyCoaches(),
    getAcknowledgments(),
  ]);

  const engaged = myCoaches.some(
    (c) => c.otherUserId === coachId && c.status === "active"
  );

  return (
    <CoachProfileView
      coach={coach}
      reviews={reviews}
      plans={plans}
      engaged={engaged}
      acks={acks}
    />
  );
}
