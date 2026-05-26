// ---------------------------------------------------------------------------
// /settings/streaks — choose how streaks are displayed (globally, or per
// activity), and whether to show the x/y + % statistics.
// ---------------------------------------------------------------------------

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import { isStreakMode, type StreakMode } from "@/lib/domain/streak";

import { SettingsShell } from "../_settings-shell";
import { StreaksForm } from "./streaks-form";

export default async function StreaksSettingsPage() {
  const { supabase, user } = await requireOnboardedUser();

  const [{ data: profile }, { data: activityRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "streak_scope, streak_mode, streak_stats, streak_stats_accuracy, streak_goal"
      )
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("activities")
      .select("id, name, streak_mode, streak_goal")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .order("name", { ascending: true }),
  ]);

  const p = (profile ?? {}) as {
    streak_scope?: string;
    streak_mode?: string;
    streak_stats?: boolean;
    streak_stats_accuracy?: boolean;
    streak_goal?: number | null;
  };

  const activities = (
    (activityRows ?? []) as Array<{
      id: string;
      name: string;
      streak_mode: string | null;
      streak_goal: number | null;
    }>
  ).map((a) => ({
    id: a.id,
    name: a.name,
    mode: (isStreakMode(a.streak_mode) ? a.streak_mode : "none") as StreakMode,
    goal: a.streak_goal ?? null,
  }));

  return (
    <SettingsShell title="Streaks">
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        Habits are about forming a new identity. Streaks at their best are an
        additional tool to help you build evidence toward accepting your new
        desired identity — nothing more or less. Choose the streak setting you
        believe will be most helpful for your identity building.
      </p>

      <StreaksForm
        initialScope={p.streak_scope === "independent" ? "independent" : "same"}
        initialMode={isStreakMode(p.streak_mode) ? p.streak_mode : "none"}
        initialStats={p.streak_stats ?? true}
        initialStatsAccuracy={p.streak_stats_accuracy ?? true}
        initialGoal={p.streak_goal ?? null}
        activities={activities}
      />
    </SettingsShell>
  );
}
