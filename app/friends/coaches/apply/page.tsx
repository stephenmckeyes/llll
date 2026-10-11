// ---------------------------------------------------------------------------
// /friends/coaches/apply — the dedicated "Become a coach" application page.
// ---------------------------------------------------------------------------

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import { getAcknowledgments } from "@/app/actions/agreements";
import { getMyCoachProfile } from "@/app/actions/coaches";

import { ApplyCoachView } from "./apply-view";

export default async function ApplyCoachPage() {
  await requireOnboardedUser();
  const [myProfile, acks] = await Promise.all([
    getMyCoachProfile(),
    getAcknowledgments(),
  ]);
  return <ApplyCoachView myProfile={myProfile} acks={acks} />;
}
