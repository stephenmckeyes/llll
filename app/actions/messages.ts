// ---------------------------------------------------------------------------
// Direct messages between friends (migration 0014).
//
//   - sendMessage(recipientId, body, quote?) — send a message, optionally
//     quoting an activity (a reply to a friend's shared rhythm, or an
//     "ask for help" about one of your own). RLS enforces friendship.
//   - getConversation(friendId) — the full thread with a friend, oldest
//     first, AND marks their messages to you as read (so opening the chat
//     clears the unread notification).
//   - getUnreadCounts() — unread messages grouped by sender, for the
//     Notifications "Messages" section + per-friend unread badges.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type Message = {
  id: string;
  senderId: string;
  recipientId: string;
  body: string;
  quotedActivityId: string | null;
  quotedActivityName: string | null;
  quotedScheduledFor: string | null;
  quotedStatus: string | null;
  /** Marks the message as an Ask-for-help request (migration 0028). */
  isHelpRequest: boolean;
  /** Marks the message as a "shared with you" notification
   *  (migration 0030). Renders the same panel as help-request, minus
   *  the red urgency. */
  isShareNotification: boolean;
  createdAt: string;
  readAt: string | null;
};

export async function sendMessage(
  recipientId: string,
  body: string,
  quote?: {
    activityId?: string | null;
    activityName?: string | null;
    /** When quoting a specific occurrence: its date + a status label. */
    scheduledFor?: string | null;
    statusLabel?: string | null;
  }
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const text = body.trim();
  const quotedName = quote?.activityName?.trim() || null;
  // A message must carry SOMETHING — either text or a quoted activity.
  if (!text && !quotedName) return { error: "Write a message first." };
  if (text.length > 4000) {
    return { error: "That message is too long (max 4000)." };
  }
  if (recipientId === user.id) {
    return { error: "You can't message yourself." };
  }

  const scheduledFor = quote?.scheduledFor ?? null;
  const statusLabel = quote?.statusLabel?.trim() || null;

  const { error } = await supabase.from("messages").insert({
    sender_id: user.id,
    recipient_id: recipientId,
    body: text,
    quoted_activity_id: quote?.activityId ?? null,
    quoted_activity_name: quotedName,
    quoted_scheduled_for: scheduledFor,
    quoted_status: statusLabel,
  });
  // 23503 = FK violation (e.g. quoted activity vanished) — retry without the
  // quote id so the message still sends.
  if (error) {
    if (error.code === "23503" && quote?.activityId) {
      const { error: e2 } = await supabase.from("messages").insert({
        sender_id: user.id,
        recipient_id: recipientId,
        body: text,
        quoted_activity_id: null,
        quoted_activity_name: quotedName,
        quoted_scheduled_for: scheduledFor,
        quoted_status: statusLabel,
      });
      if (e2) return { error: e2.message };
    } else {
      return { error: error.message };
    }
  }

  revalidatePath(`/friends/${recipientId}/chat`);
  revalidatePath("/notifications");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// sendHelpRequest — dispatch an Ask-for-help message to one or more
// friends AND make sure each recipient has the activity shared with them
// so they can actually open the calendar/grid/total the panel links to.
//
// Everything happens server-side in one call so the client doesn't have to
// juggle per-friend share-then-message round-trips.
// ---------------------------------------------------------------------------

export async function sendHelpRequest({
  friendIds,
  activityId,
  activityName,
  note,
}: {
  friendIds: string[];
  activityId: string;
  activityName: string;
  note: string;
}): Promise<{ error: string } | { ok: true; autoSharedTo: string[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (friendIds.length === 0) return { error: "Choose at least one friend." };
  if (!activityId || !activityName)
    return { error: "Pick an activity you'd like help with." };

  const text = note.trim().slice(0, 4000);

  // 1. Look up which recipients ALREADY have the activity shared with
  //    them (share_progress=true). Any not in the returned set will
  //    receive an auto-share below — the help-request panel links to
  //    the sender's calendar/grid/total, which only render when the
  //    activity is shared.
  const { data: existingShares } = await supabase
    .from("activity_shares")
    .select("shared_with_id")
    .eq("activity_id", activityId)
    .eq("owner_id", user.id)
    .in("shared_with_id", friendIds);
  const alreadyShared = new Set(
    ((existingShares ?? []) as Array<{ shared_with_id: string }>).map(
      (s) => s.shared_with_id
    )
  );

  const missingShareIds = friendIds.filter((f) => !alreadyShared.has(f));

  // 2. Insert the missing shares. `share_progress=true` so the friend
  //    sees the owner's history — the whole point of the help ask is
  //    that they can inspect what's going on. Silently ignore
  //    duplicates via the unique index (activity_id, shared_with_id).
  if (missingShareIds.length > 0) {
    const rows = missingShareIds.map((sharedWithId) => ({
      activity_id: activityId,
      owner_id: user.id,
      shared_with_id: sharedWithId,
      share_progress: true,
    }));
    const { error: sErr } = await supabase
      .from("activity_shares")
      .upsert(rows, {
        onConflict: "activity_id,shared_with_id",
        ignoreDuplicates: true,
      });
    if (sErr) return { error: sErr.message };
  }

  // 3. Insert one message per recipient. Marked is_help_request=true so
  //    the chat picks up the big red panel render.
  const messageRows = friendIds.map((recipientId) => ({
    sender_id: user.id,
    recipient_id: recipientId,
    body: text,
    quoted_activity_id: activityId,
    quoted_activity_name: activityName,
    quoted_scheduled_for: null,
    quoted_status: null,
    is_help_request: true,
  }));
  const { error: mErr } = await supabase.from("messages").insert(messageRows);
  if (mErr) return { error: mErr.message };

  // 4. Revalidate every affected surface so the chat / notifications
  //    pages pick up the new messages on next render.
  for (const rid of friendIds) {
    revalidatePath(`/friends/${rid}/chat`);
  }
  revalidatePath("/notifications");

  return { ok: true, autoSharedTo: missingShareIds };
}

export async function getConversation(friendId: string): Promise<Message[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("messages")
    .select(
      "id, sender_id, recipient_id, body, quoted_activity_id, quoted_activity_name, quoted_scheduled_for, quoted_status, is_help_request, is_share_notification, created_at, read_at"
    )
    .or(
      `and(sender_id.eq.${user.id},recipient_id.eq.${friendId}),and(sender_id.eq.${friendId},recipient_id.eq.${user.id})`
    )
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as Array<{
    id: string;
    sender_id: string;
    recipient_id: string;
    body: string;
    quoted_activity_id: string | null;
    quoted_activity_name: string | null;
    quoted_scheduled_for: string | null;
    quoted_status: string | null;
    is_help_request: boolean;
    is_share_notification: boolean;
    created_at: string;
    read_at: string | null;
  }>;

  // Mark the friend's messages to me as read (clears the notification).
  const unreadFromFriend = rows.some(
    (r) => r.sender_id === friendId && r.read_at === null
  );
  if (unreadFromFriend) {
    await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("recipient_id", user.id)
      .eq("sender_id", friendId)
      .is("read_at", null);
  }

  return rows.map((r) => ({
    id: r.id,
    senderId: r.sender_id,
    recipientId: r.recipient_id,
    body: r.body,
    quotedActivityId: r.quoted_activity_id,
    quotedActivityName: r.quoted_activity_name,
    quotedScheduledFor: r.quoted_scheduled_for,
    quotedStatus: r.quoted_status,
    isHelpRequest: r.is_help_request,
    isShareNotification: r.is_share_notification,
    createdAt: r.created_at,
    readAt: r.read_at,
  }));
}

// Unread message counts grouped by SENDER (the friend who messaged you).
export async function getUnreadCounts(): Promise<Record<string, number>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Share notifications are already surfaced via the "Shared with you"
  // section (rows on activity_shares) — counting them here too would
  // double-notify the recipient. is_help_request and plain messages
  // still count.
  const { data } = await supabase
    .from("messages")
    .select("sender_id")
    .eq("recipient_id", user.id)
    .eq("is_share_notification", false)
    .is("read_at", null);

  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ sender_id: string }>) {
    counts[r.sender_id] = (counts[r.sender_id] ?? 0) + 1;
  }
  return counts;
}
