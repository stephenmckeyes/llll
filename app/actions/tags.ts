// ---------------------------------------------------------------------------
// Server actions for tags.
//
// Tags are per-user. The DB has a UNIQUE (user_id, name) index, so the
// usual flow is: try to insert; on conflict, return the existing row.
// This lets the picker call createTag() optimistically without first
// checking whether the name already exists.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

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
  // ---- 1. Validate input -------------------------------------------------

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

  // ---- 2. Auth + upsert --------------------------------------------------

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Try insert; if there's already a row for this (user_id, name) it
  // means the user picked an existing name — fetch + return that row
  // instead of erroring. The picker shows this as "already a tag, just
  // selecting it for you."
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
        // Brand-new tag, not attached to anything yet — server-side
        // usage starts at 0. The picker bumps the value as the user
        // selects the tag this session, but the durable count comes
        // from the next page render.
        usage: 0,
      },
    };
  }

  // 23505 = unique_violation. Fall through to fetch the existing row.
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
      // We don't have the current usage count here without an extra
      // query — start at 0 and let the next page render pick up the
      // real value from computeTagUsage.
      usage: 0,
    },
  };
}
