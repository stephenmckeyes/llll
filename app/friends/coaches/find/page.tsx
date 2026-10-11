// ---------------------------------------------------------------------------
// /friends/coaches/find — the dedicated Find-a-Coach directory page.
// ---------------------------------------------------------------------------

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import { getAcknowledgments } from "@/app/actions/agreements";
import { getCoachDirectory, getMyCoaches } from "@/app/actions/coaches";

import { FindCoachView } from "./find-view";

export default async function FindCoachPage() {
  await requireOnboardedUser();
  const [directory, myCoaches, acks] = await Promise.all([
    getCoachDirectory(),
    getMyCoaches(),
    getAcknowledgments(),
  ]);
  const engagedIds = myCoaches
    .filter((c) => c.status === "active")
    .map((c) => c.otherUserId);

  return (
    <FindCoachView directory={directory} engagedIds={engagedIds} acks={acks} />
  );
}
