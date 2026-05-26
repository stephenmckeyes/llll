// ---------------------------------------------------------------------------
// updateStreakSettings — persist the Settings → Streaks choices: the global
// scope/mode/stats/goal on the profile, plus per-activity modes when the
// user chose "set streaks independently".
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { isStreakMode, type StreakMode } from "@/lib/domain/streak";

export type StreakSettingsState = { error: string } | { ok: true } | null;

export type StreakSettingsInput = {
  scope: "same" | "independent";
  globalMode: StreakMode;
  globalGoal: number | null;
  stats: boolean;
  /** When stats is on: true → "X/Y · Z%" (accuracy), false → just the
   *  completed count. */
  statsAccuracy: boolean;
  perActivity: Array<{ id: string; mode: StreakMode; goal: number | null }>;
};

function cleanGoal(n: number | null): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  const v = Math.floor(n);
  if (v <= 0) return null;
  return Math.min(v, 100000);
}

export async function updateStreakSettings(
  input: StreakSettingsInput
): Promise<StreakSettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const scope = input.scope === "independent" ? "independent" : "same";
  const globalMode = isStreakMode(input.globalMode) ? input.globalMode : "none";

  const { error: pErr } = await supabase
    .from("profiles")
    .update({
      streak_scope: scope,
      streak_mode: globalMode,
      streak_stats: Boolean(input.stats),
      streak_stats_accuracy: Boolean(input.statsAccuracy),
      streak_goal: globalMode === "countdown" ? cleanGoal(input.globalGoal) : null,
    })
    .eq("id", user.id);
  if (pErr) return { error: pErr.message };

  // Per-activity modes only matter (and are only collected) in independent
  // mode. RLS scopes updates to the user's own activities.
  if (scope === "independent") {
    for (const a of input.perActivity) {
      const mode = isStreakMode(a.mode) ? a.mode : "none";
      const { error } = await supabase
        .from("activities")
        .update({
          streak_mode: mode,
          streak_goal: mode === "countdown" ? cleanGoal(a.goal) : null,
        })
        .eq("id", a.id)
        .eq("user_id", user.id);
      if (error) return { error: error.message };
    }
  }

  revalidatePath("/");
  revalidatePath("/settings/streaks");
  return { ok: true };
}
