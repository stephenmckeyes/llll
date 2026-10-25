// ---------------------------------------------------------------------------
// /friends/coaches/apply — the dedicated "Become a coach" application page.
// ---------------------------------------------------------------------------

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import { getAcknowledgments } from "@/app/actions/agreements";
import {
  getMyClients,
  getMyCoachProfile,
  getMyCoachTemplates,
} from "@/app/actions/coaches";

import { ApplyCoachView } from "./apply-view";

export default async function ApplyCoachPage() {
  await requireOnboardedUser();
  const [myProfile, acks] = await Promise.all([
    getMyCoachProfile(),
    getAcknowledgments(),
  ]);
  // The plan library + client list only matter once you're a coach (applied).
  const [templates, clients] = myProfile
    ? await Promise.all([getMyCoachTemplates(), getMyClients()])
    : [[], []];

  return (
    <ApplyCoachView
      myProfile={myProfile}
      acks={acks}
      templates={templates}
      clients={clients}
    />
  );
}
