"use server";

// ---------------------------------------------------------------------------
// Server actions for tags — create + delete.
//
// createTag is idempotent on (user_id, name) via upsert (23505 → fetch
// existing). Delete cascades: strip the name from every activity and
// completion history that references it (see delete_tag_cascade RPC),
// then drop the tag row.
// ---------------------------------------------------------------------------

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";
import { createClient } from "@/lib/supabase/server";
import {
  isValidTagColor,
  type TagInfo,
} from "@/lib/domain/tags";

export type CreateTagResult =
  | { ok: true; tag: TagInfo }
  | { ok: false; error: string };

/**
 * Create (or fetch if it already exists) a tag for the current user.
 *
 * Idempotent on (user_id, name) via upsert. The picker fires this when
 * the user clicks "+ New tag" — if they accidentally pick a name that
 * already exists, we return the existing row instead of erroring,
 * which matches the user's mental model ("the tag already exists,
 * just use it").
 */
export async function createTag(
  name: string,
  color: string
): Promise<CreateTagResult> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Tag name can't be empty." };
  }
  if (trimmed.length > 50) {
    return { ok: false, error: "Tag name is too long (max 50)." };
  }
  if (!isValidTagColor(color)) {
    return { ok: false, error: `Invalid color: ${color}.` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: inserted, error: insertErr } = await supabase
    .from("tags")
    .insert({
      user_id: user.id,
      name: trimmed,
      color,
    })
    .select("id, name, color")
    .single();

  if (inserted) {
    revalidatePath("/");
    revalidatePath("/activities");
    revalidatePath("/activities/new");
    return {
      ok: true,
      tag: {
        id: inserted.id as string,
        name: inserted.name as string,
        color: inserted.color as TagInfo["color"],
        usage: 0,
      },
    };
  }

  if (insertErr && insertErr.code !== "23505") {
    return { ok: false, error: insertErr.message };
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("tags")
    .select("id, name, color")
    .eq("user_id", user.id)
    .eq("name", trimmed)
    .single();

  if (fetchErr || !existing) {
    return { ok: false, error: fetchErr?.message ?? "Tag not found." };
  }

  return {
    ok: true,
    tag: {
      id: existing.id as string,
      name: existing.name as string,
      color: existing.color as TagInfo["color"],
      usage: 0,
    },
  };
}

// ---------------------------------------------------------------------------

export type DeleteTagResult =
  | { ok: true; removedFromActivities: number; removedFromInstances: number }
  | { ok: false; error: string };

/**
 * Delete a tag and strip its name from every activity + instance that
 * references it. Cascades via the delete_tag_cascade RPC (migration
 * 0038) which does all three writes in one transaction. Falls back to
 * per-statement writes if the RPC isn't deployed yet.
 */
export async function deleteTag(tagId: string): Promise<DeleteTagResult> {
  const { supabase, user } = await requireOnboardedUser();

  const { data: tagRow, error: readErr } = await supabase
    .from("tags")
    .select("id, name, user_id")
    .eq("id", tagId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };
  if (!tagRow) return { ok: false, error: "Tag not found." };
  if (tagRow.user_id !== user.id) {
    return { ok: false, error: "Not allowed." };
  }

  const { data: rpcData, error: rpcErr } = await supabase.rpc(
    "delete_tag_cascade",
    { p_tag_id: tagRow.id, p_tag_name: tagRow.name }
  );

  if (!rpcErr && rpcData) {
    revalidatePath("/settings/tags");
    revalidatePath("/");
    revalidatePath("/activities");
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    return {
      ok: true,
      removedFromActivities: Number(row?.removed_from_activities ?? 0),
      removedFromInstances: Number(row?.removed_from_instances ?? 0),
    };
  }

  // Fallback path — RPC not deployed yet. Not atomic but functional.
  // Fetch each affected row and rewrite its array without the target
  // name. `.update({ default_skill_tags: [] })` on the whole match
  // would wipe every OTHER tag too — a subtle data-loss bug.
  const { data: actRows, error: actReadErr } = await supabase
    .from("activities")
    .select("id, default_skill_tags")
    .eq("user_id", user.id)
    .contains("default_skill_tags", [tagRow.name]);
  if (actReadErr) return { ok: false, error: actReadErr.message };

  let removedFromActivities = 0;
  for (const row of actRows ?? []) {
    const current = (row as { default_skill_tags: string[] | null })
      .default_skill_tags ?? [];
    const next = current.filter((n) => n !== tagRow.name);
    const { error } = await supabase
      .from("activities")
      .update({ default_skill_tags: next })
      .eq("id", (row as { id: string }).id)
      .eq("user_id", user.id);
    if (error) return { ok: false, error: error.message };
    removedFromActivities += 1;
  }

  // activity_instances has no direct user_id column — ownership flows
  // through activity_id → activities.user_id. RLS enforces the scope.
  const { data: instRows, error: instReadErr } = await supabase
    .from("activity_instances")
    .select("id, tags")
    .contains("tags", [tagRow.name]);
  if (instReadErr) return { ok: false, error: instReadErr.message };

  let removedFromInstances = 0;
  for (const row of instRows ?? []) {
    const current = (row as { tags: string[] | null }).tags ?? [];
    const next = current.filter((n) => n !== tagRow.name);
    const { error } = await supabase
      .from("activity_instances")
      .update({ tags: next })
      .eq("id", (row as { id: string }).id);
    if (error) return { ok: false, error: error.message };
    removedFromInstances += 1;
  }

  const { error: delErr } = await supabase
    .from("tags")
    .delete()
    .eq("id", tagRow.id)
    .eq("user_id", user.id);
  if (delErr) return { ok: false, error: delErr.message };

  revalidatePath("/settings/tags");
  revalidatePath("/");
  revalidatePath("/activities");
  return { ok: true, removedFromActivities, removedFromInstances };
}
