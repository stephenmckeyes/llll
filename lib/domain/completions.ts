// ---------------------------------------------------------------------------
// logCompletion() — THE single entry point for creating a completion.
//
// Design-doc rule #3:
//   "All completion creation — habit instance, task done, ad-hoc log,
//    future quest, future Strava import — routes through one function.
//    Skill XP calculation, streak updates, notification clearing all live
//    here. New sources add callers, never fork the logic."
//
// Architectural promises this function must keep:
//   - Self-contained: copy skill_tags + metrics + visibility from the
//     producer at creation, do not just link.
//   - Append-only: a successful call creates one new row in `completions`
//     (plus link rows). Never updates or deletes prior completions.
//   - Soft-delete only: callers wanting to undo must call a separate
//     softDeleteCompletion(); never reach in and DELETE.
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
  /** Instances this completion satisfies (recurring habits). */
  instanceIds?: string[];
  /** Tasks this completion satisfies (one-offs). */
  taskIds?: string[];
  /**
   * Skill tags + metrics. If linked to one producer, the caller can let
   * logCompletion copy from that producer by leaving these undefined and
   * passing `copyFromProducer: true`. For ad-hoc logs, pass them directly.
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
  const taskIds = input.taskIds ?? [];

  // -----------------------------------------------------------------------
  // 1. If skill_tags / metrics weren't supplied, copy from the producer.
  //    Single linked producer is the common case; for multi-link, we take
  //    the first one's defaults (rare; explicit override is also possible).
  // -----------------------------------------------------------------------

  let skillTags = input.skillTags;
  let metrics = input.metrics;

  if ((skillTags === undefined || metrics === undefined) && instanceIds[0]) {
    const { data } = await supabase
      .from("recurring_activity_instances")
      .select(
        "recurring_activities ( default_skill_tags, default_metrics )"
      )
      .eq("id", instanceIds[0])
      .single();
    const ra = (data as {
      recurring_activities?: {
        default_skill_tags?: string[] | null;
        default_metrics?: Record<string, unknown> | null;
      };
    } | null)?.recurring_activities;
    skillTags ??= ra?.default_skill_tags ?? [];
    metrics ??= ra?.default_metrics ?? {};
  }

  if ((skillTags === undefined || metrics === undefined) && taskIds[0]) {
    const { data } = await supabase
      .from("tasks")
      .select("default_skill_tags")
      .eq("id", taskIds[0])
      .single();
    const t = data as { default_skill_tags?: string[] | null } | null;
    skillTags ??= t?.default_skill_tags ?? [];
    metrics ??= {};
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

  if (taskIds.length > 0) {
    const { error } = await supabase
      .from("completion_tasks")
      .insert(taskIds.map((id) => ({
        completion_id: completion.id,
        task_id: id,
      })));
    if (error) return { ok: false, error: error.message };
  }

  // -----------------------------------------------------------------------
  // 4. Update producer status.
  //    For instances: mark `completed` (frequency rhythms will need a
  //    smarter rule later — "completed only when N completions linked";
  //    handled when frequency rhythms ship).
  //    For tasks: mark `completed`.
  // -----------------------------------------------------------------------

  if (instanceIds.length > 0) {
    await supabase
      .from("recurring_activity_instances")
      .update({ status: "completed" })
      .in("id", instanceIds);
  }

  if (taskIds.length > 0) {
    await supabase
      .from("tasks")
      .update({ status: "completed" })
      .in("id", taskIds);
  }

  // -----------------------------------------------------------------------
  // 5. (Future: XP, streaks, notification-clearing all go HERE.)
  // -----------------------------------------------------------------------

  return { ok: true, completionId: completion.id };
}
