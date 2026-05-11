// ---------------------------------------------------------------------------
// logCompletion() — THE single entry point for creating a completion.
//
// Design-doc rule #3:
//   "All completion creation — habit instance, task done, ad-hoc log,
//    future quest, future Strava import — routes through one function."
//
// v2 (post-unification): every completion links to zero or more
// activity_instances (M:N). The old separate task path is gone — tasks are
// now `{type:"single"}` activities that produce one instance like everything
// else.
//
// Architectural promises this function keeps:
//   - Self-contained: skill_tags + metrics + visibility are copied from the
//     producer at creation, not just FK-referenced.
//   - Append-only: success = one new completion row (+ link rows). Never
//     updates or deletes prior completions.
//   - Soft-delete only: callers wanting to undo must call a separate
//     softDeleteCompletion(); never reach in and DELETE.
//   - Frequency-aware: when linking to a frequency-rhythm instance, the
//     instance is only marked `completed` once `rhythm.count` completions
//     are linked.
//
// Future additions (XP, streaks, notifications) go HERE — not in callers.
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

export type Visibility = "private" | "friends" | "clan" | "public";

export type LogCompletionInput = {
  /** When the activity actually happened. Defaults to "now". */
  occurredAt?: Date;
  /** Optional subjective effort 1-5. */
  effortRating?: number;
  /** Optional free-text note. */
  note?: string;
  /** Defaults to "private". */
  visibility?: Visibility;
  /** Instances this completion satisfies (zero, one, or many). */
  instanceIds?: string[];
  /**
   * Skill tags + metrics. If linked to one or more instances, leave these
   * undefined to copy from the first linked instance's parent activity.
   * For ad-hoc logs, pass them directly.
   */
  skillTags?: string[];
  metrics?: Record<string, unknown>;
};

export type LogCompletionResult =
  | { ok: true; completionId: string }
  | { ok: false; error: string };

export async function logCompletion(
  supabase: SupabaseClient,
  userId: string,
  input: LogCompletionInput
): Promise<LogCompletionResult> {
  const instanceIds = input.instanceIds ?? [];

  // -----------------------------------------------------------------------
  // 1. If skill_tags / metrics weren't supplied, copy from the parent
  //    activity of the first linked instance.
  // -----------------------------------------------------------------------

  let skillTags = input.skillTags;
  let metrics = input.metrics;

  if ((skillTags === undefined || metrics === undefined) && instanceIds[0]) {
    const { data } = await supabase
      .from("activity_instances")
      .select("activities ( default_skill_tags, default_metrics )")
      .eq("id", instanceIds[0])
      .single();
    const a = (data as {
      activities?: {
        default_skill_tags?: string[] | null;
        default_metrics?: Record<string, unknown> | null;
      };
    } | null)?.activities;
    skillTags ??= a?.default_skill_tags ?? [];
    metrics ??= a?.default_metrics ?? {};
  }

  // Final fallback for true ad-hoc logs.
  skillTags ??= [];
  metrics ??= {};

  // -----------------------------------------------------------------------
  // 2. Create the completion row.
  // -----------------------------------------------------------------------

  const { data: completion, error: cerr } = await supabase
    .from("completions")
    .insert({
      user_id: userId,
      occurred_at: (input.occurredAt ?? new Date()).toISOString(),
      skill_tags: skillTags,
      metrics,
      effort_rating: input.effortRating ?? null,
      note: input.note ?? null,
      visibility: input.visibility ?? "private",
    })
    .select("id")
    .single();

  if (cerr || !completion) {
    return { ok: false, error: cerr?.message ?? "Insert failed" };
  }

  // -----------------------------------------------------------------------
  // 3. Link rows (M:N).
  // -----------------------------------------------------------------------

  if (instanceIds.length > 0) {
    const { error } = await supabase
      .from("completion_instances")
      .insert(instanceIds.map((id) => ({
        completion_id: completion.id,
        instance_id: id,
      })));
    if (error) return { ok: false, error: error.message };
  }

  // -----------------------------------------------------------------------
  // 4. Update instance status, per-instance.
  //
  //    Non-frequency rhythms (single/daily/weekdays/interval):
  //      one completion = done.
  //    Frequency rhythms:
  //      only mark `completed` once N completions are linked, where N
  //      comes from the activity's rhythm.count. Until then the instance
  //      stays pending and the today view keeps showing it with the
  //      "Goal X/N" progress display.
  // -----------------------------------------------------------------------

  for (const instId of instanceIds) {
    const { data: row } = await supabase
      .from("activity_instances")
      .select(
        `
        activities ( rhythm ),
        completion_instances ( completion_id )
      `
      )
      .eq("id", instId)
      .single();

    const wrapper = row as {
      activities?: { rhythm?: unknown } | null;
      completion_instances?: Array<unknown> | null;
    } | null;
    const rhythm = wrapper?.activities?.rhythm as
      | { type?: string; count?: number }
      | undefined;
    const linkedCount = wrapper?.completion_instances?.length ?? 0;

    const shouldComplete =
      rhythm?.type === "frequency"
        ? linkedCount >= (rhythm.count ?? 1)
        : true;

    if (shouldComplete) {
      await supabase
        .from("activity_instances")
        .update({ status: "completed" })
        .eq("id", instId);
    }
  }

  // -----------------------------------------------------------------------
  // 5. (Future: XP, streaks, notification-clearing all go HERE.)
  // -----------------------------------------------------------------------

  return { ok: true, completionId: completion.id };
}
