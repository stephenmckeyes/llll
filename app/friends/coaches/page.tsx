// ---------------------------------------------------------------------------
// /friends/coaches — Coaches tab (placeholder).
//
// Coaches will be a professional-help marketplace: certified coaches list
// themselves (eventually paid; early coaches likely free to seed the
// platform) and members seek professional guidance toward their goals —
// fitness or otherwise. Intentionally blank for now; the full community
// machinery (a 'coach' community kind + discovery + booking) lands later.
// ---------------------------------------------------------------------------

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { CommunityShell } from "../_community-shell";

export default async function CoachesTabPage() {
  await requireOnboardedUser();

  return (
    <CommunityShell active="coaches">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <h2 className="text-lg font-semibold tracking-tight">
          Coaches are coming soon
        </h2>
        <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">
          A place to find professional coaches — for fitness or any other goal
          — and get expert help accomplishing your mission. Certified coaches
          will be able to list themselves here.
        </p>
      </div>
    </CommunityShell>
  );
}
