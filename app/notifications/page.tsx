// ---------------------------------------------------------------------------
// /notifications — two sections:
//   1. Social: incoming friend requests (accept / decline here).
//   2. Reminders: activities that have slipped past their day without a
//      verdict (the closest thing to "reminders" until scheduled
//      reminder delivery ships). Each links to the day it was due.
// ---------------------------------------------------------------------------

import { startOfWeek, format } from "date-fns";
import Link from "next/link";

import { getSocialOverview, type SocialEntry } from "@/app/actions/friends";
import { getUnreadCounts } from "@/app/actions/messages";
import { getSharedInstancesWithMe, getSharedWithMe } from "@/app/actions/sharing";
import { getWatches } from "@/app/actions/watches";
import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { PendingLink } from "@/app/_components/pending-link";

import { buildFriendActivityNotifications } from "./friend-activity";
import { FriendActivityNotifications } from "./friend-activity-notifications";
import { RequestActions } from "./request-actions";
import { SharedNotifications } from "./shared-notifications";

function nameOf(e: SocialEntry): string {
  return e.otherDisplayName || (e.otherUsername ? `@${e.otherUsername}` : "Someone");
}

function todayInTimeZone(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function formatDmy(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default async function NotificationsPage() {
  const { supabase, user, profile } = await requireOnboardedUser();
  const todayStr = todayInTimeZone(profile.timezone ?? "UTC");

  // Window for watch reminders: 7 days back covers the "each" feed and the
  // current week-so-far (which starts at most 6 days ago).
  const weekStart = format(
    startOfWeek(new Date(`${todayStr}T00:00:00`), { weekStartsOn: 1 }),
    "yyyy-MM-dd"
  );
  const from = (() => {
    const d = new Date(`${todayStr}T00:00:00`);
    d.setDate(d.getDate() - 7);
    return format(d, "yyyy-MM-dd");
  })();

  const [entries, shares, watches, sharedInstances, unread] =
    await Promise.all([
      getSocialOverview(),
      getSharedWithMe(),
      getWatches(),
      getSharedInstancesWithMe(from, todayStr),
      getUnreadCounts(),
    ]);
  const incoming = entries.filter(
    (e) => e.status === "pending" && e.direction === "incoming"
  );

  // Unread DMs grouped by sender → "X messaged you" notes. Names come from
  // the social overview (we only ever get messages from accepted friends).
  const nameById = new Map(
    entries.map((e) => [
      e.otherId,
      e.otherDisplayName ||
        (e.otherUsername ? `@${e.otherUsername}` : "A friend"),
    ])
  );
  const messageNotes = Object.entries(unread)
    .map(([senderId, count]) => ({
      senderId,
      count,
      name: nameById.get(senderId) ?? "A friend",
    }))
    .sort((a, b) => b.count - a.count);

  // Live "Friend activity" reminders from the activities the user watches.
  const sharedById = new Map(shares.map((s) => [s.activityId, s]));
  const friendNotes = buildFriendActivityNotifications({
    watches,
    sharedById,
    instances: sharedInstances,
    todayStr,
    weekStart,
  });

  // Reminders = past-due pending instances on active activities. Two-step
  // query (active activity ids, then their overdue pending instances) for
  // the same reliability reason fetchIncompleteInfo uses on the dashboard.
  const { data: activeIds } = await supabase
    .from("activities")
    .select("id, name")
    .is("archived_at", null);
  const idToName = new Map(
    ((activeIds ?? []) as Array<{ id: string; name: string }>).map((a) => [
      a.id,
      a.name,
    ])
  );

  type OverdueRow = {
    id: string;
    activity_id: string;
    scheduled_for: string;
    name: string | null;
  };
  let overdue: OverdueRow[] = [];
  if (idToName.size > 0) {
    const { data } = await supabase
      .from("activity_instances")
      .select("id, activity_id, scheduled_for, name")
      .in("activity_id", Array.from(idToName.keys()))
      .eq("status", "pending")
      .lt("scheduled_for", todayStr)
      .order("scheduled_for", { ascending: true })
      .limit(50);
    overdue = (data ?? []) as OverdueRow[];
  }

  void user;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-8 bg-white p-6 dark:bg-zinc-950">
      <header className="flex flex-col gap-1">
        <PendingLink
          href="/"
          className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Mission
        </PendingLink>
        <h1 className="text-3xl font-semibold tracking-tight">Notifications</h1>
      </header>

      {/* 1. Social */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Friend requests ({incoming.length})
        </h2>
        {incoming.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No pending requests.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {incoming.map((r) => (
              <li
                key={r.friendshipId}
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{nameOf(r)}</p>
                  {r.otherUsername && (
                    <p className="truncate text-xs text-zinc-500">
                      @{r.otherUsername} wants to be friends
                    </p>
                  )}
                </div>
                <RequestActions friendshipId={r.friendshipId} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 1a. Messages */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Messages ({messageNotes.length})
        </h2>
        {messageNotes.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No new messages.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messageNotes.map((m) => (
              <li key={m.senderId}>
                <Link
                  href={`/friends/${m.senderId}/chat`}
                  className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{m.name}</span> sent you{" "}
                    {m.count} message{m.count === 1 ? "" : "s"}
                  </span>
                  <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-semibold text-white">
                    {m.count > 99 ? "99+" : m.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 1b. Shared with you */}
      <SharedNotifications shares={shares} />

      {/* 1c. Friend activity (watched rhythms) */}
      <FriendActivityNotifications notes={friendNotes} />

      {/* 2. Reminders */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Reminders ({overdue.length})
        </h2>
        {overdue.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            You&rsquo;re all caught up — nothing overdue.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {overdue.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/?view=day&date=${o.scheduled_for}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
                >
                  <span className="min-w-0 truncate font-medium">
                    {o.name ?? idToName.get(o.activity_id) ?? "Activity"}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400">
                    {formatDmy(o.scheduled_for)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
