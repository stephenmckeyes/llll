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

  // 23505 = unique_violation on (user_id, name). Fetch the existing
  // row and — if it was archived — auto-unarchive it, so a user
  // re-creating a previously-archived tag from the picker just
  // resurrects it instead of hitting a mysterious "already exists"
  // error (archived tags don't show up in the picker, so the user
  // has no visible cue that the name is taken).
  const { data: existing, error: fetchErr } = await supabase
    .from("tags")
    .select("id, name, color, archived_at")
    .eq("user_id", user.id)
    .eq("name", trimmed)
    .single();

  if (fetchErr || !existing) {
    return { ok: false, error: fetchErr?.message ?? "Tag not found." };
  }

  if ((existing as { archived_at: string | null }).archived_at) {
    const { error: unarchiveErr } = await supabase
      .from("tags")
      .update({ archived_at: null })
      .eq("id", (existing as { id: string }).id)
      .eq("user_id", user.id);
    if (unarchiveErr) return { ok: false, error: unarchiveErr.message };
    revalidatePath("/settings/tags");
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

export type ArchiveTagResult = { ok: true } | { ok: false; error: string };

/**
 * Soft-archive a tag. Hides it from every picker + filter surface
 * while preserving the row (and the tag name inside every activity
 * and completion history array that already references it — the
 * banner chips still render with the right color, they just can't be
 * newly assigned).
 *
 * Undo via `unarchiveTag`. Mirrors how activities archive.
 */
export async function archiveTag(tagId: string): Promise<ArchiveTagResult> {
  const { supabase, user } = await requireOnboardedUser();
  const { error } = await supabase
    .from("tags")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", tagId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/tags");
  revalidatePath("/");
  revalidatePath("/activities");
  revalidatePath("/settings/appearance");
  return { ok: true };
}

/** Restore an archived tag. Puts it back into the picker + filter
 *  surfaces. Existing activity references are unaffected either way. */
export async function unarchiveTag(tagId: string): Promise<ArchiveTagResult> {
  const { supabase, user } = await requireOnboardedUser();
  const { error } = await supabase
    .from("tags")
    .update({ archived_at: null })
    .eq("id", tagId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/tags");
  revalidatePath("/");
  revalidatePath("/activities");
  revalidatePath("/settings/appearance");
  return { ok: true };
}
