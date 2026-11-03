// ---------------------------------------------------------------------------
// /friends/coaches/apply — the dedicated "Become a coach" application page.
// ---------------------------------------------------------------------------

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import { getAcknowledgments } from "@/app/actions/agreements";
import { getMyCoachPlans, getMyCoachProfile } from "@/app/actions/coaches";

import { ApplyCoachView } from "./apply-view";

export default async function ApplyCoachPage() {
  await requireOnboardedUser();
  const [myProfile, acks] = await Promise.all([
    getMyCoachProfile(),
    getAcknowledgments(),
  ]);
  // The plan library only matters once you're a coach (applied).
  const plans = myProfile ? await getMyCoachPlans() : [];

  return <ApplyCoachView myProfile={myProfile} acks={acks} plans={plans} />;
}
