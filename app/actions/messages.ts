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

export async function getConversation(friendId: string): Promise<Message[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("messages")
    .select(
      "id, sender_id, recipient_id, body, quoted_activity_id, quoted_activity_name, quoted_scheduled_for, quoted_status, created_at, read_at"
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

  const { data } = await supabase
    .from("messages")
    .select("sender_id")
    .eq("recipient_id", user.id)
    .is("read_at", null);

  const counts: Record<string, number> = {};
  for (const r of (data ?? []) as Array<{ sender_id: string }>) {
    counts[r.sender_id] = (counts[r.sender_id] ?? 0) + 1;
  }
  return counts;
}
