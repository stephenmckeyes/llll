// ---------------------------------------------------------------------------
// /friends/coaches/plans/[planId] — a single coaching plan's page (migration
// 0081). Title + description at the top, then the plan's activities, with
// controls to add/edit/remove activities and send the whole plan to a client.
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import { getCoachPlan, getMyClients } from "@/app/actions/coaches";

import { PlanDetailView } from "./plan-detail-view";

export default async function CoachPlanPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  await requireOnboardedUser();
  const { planId } = await params;
  const [plan, clients] = await Promise.all([
    getCoachPlan(planId),
    getMyClients(),
  ]);
  if (!plan) redirect("/friends/coaches/apply");

  return (
    <PlanDetailView
      plan={plan}
      clients={clients.filter((c) => c.status === "active")}
    />
  );
}
