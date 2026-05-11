// ---------------------------------------------------------------------------
// /today — the daily habit list.
//
// Surfaces every pending instance whose "current period" includes today:
//   - daily / weekdays / interval / frequency-day → scheduled_for == today
//   - frequency-week → scheduled_for falls anywhere in this week (Mon-Sun)
//   - frequency-month → scheduled_for falls anywhere in this calendar month
//
// We query a 31-day window of pending instances, then filter in app code
// (per-row rhythm logic is awkward in pure SQL and easy in TS).
// ---------------------------------------------------------------------------

import { startOfMonth, startOfWeek } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { InstanceRow } from "./instance-row";

type Recurrence =
  | { type: "daily" }
  | { type: "weekdays"; days: string[] }
  | { type: "interval"; days: number }
  | { type: "frequency"; count: number; period: "day" | "week" | "month" };

type PendingInstance = {
  id: string;
  scheduled_for: string;
  recurring_activities: {
    id: string;
    name: string;
    description: string | null;
    recurrence: Recurrence;
  } | null;
  completion_instances: Array<{ completion_id: string }> | null;
};

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Today as a YYYY-MM-DD string in the server's TZ. (Profile-TZ-aware
  // version lands when the settings page does.)
  const todayDate = new Date();
  const today = todayDate.toISOString().slice(0, 10);
  const windowStart = new Date(todayDate);
  windowStart.setDate(windowStart.getDate() - 31);
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("recurring_activity_instances")
    .select(
      `
      id,
      scheduled_for,
      recurring_activities (
        id,
        name,
        description,
        recurrence
      ),
      completion_instances (
        completion_id
      )
    `
    )
    .eq("status", "pending")
    .gte("scheduled_for", windowStartStr)
    .lte("scheduled_for", today)
    .order("scheduled_for");

  const raw = (data ?? []) as unknown as PendingInstance[];
  const visible = raw.filter((inst) => inCurrentPeriod(inst, today));

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-8 p-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/"
            className="text-sm text-zinc-500 underline-offset-2 hover:underline"
          >
            ← Mission
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {formatDateLong(today)}
          </p>
        </div>
        <Link
          href="/activities/new"
          className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + New
        </Link>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Habits
        </h2>

        {visible.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Nothing for today.{" "}
            <Link
              href="/activities/new"
              className="font-medium underline-offset-2 hover:underline"
            >
              Create your first activity
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((inst) => {
              const r = inst.recurring_activities?.recurrence;
              const isFrequency = r?.type === "frequency";
              return (
                <InstanceRow
                  key={inst.id}
                  instanceId={inst.id}
                  name={inst.recurring_activities?.name ?? "Untitled"}
                  description={inst.recurring_activities?.description ?? null}
                  frequencyTarget={isFrequency ? r.count : null}
                  frequencyProgress={
                    isFrequency ? inst.completion_instances?.length ?? 0 : null
                  }
                />
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}

/**
 * Decide whether an instance "belongs to today" given its rhythm.
 *   - Non-frequency: only the exact day.
 *   - Frequency:    any day inside the current period (week / month / day).
 */
function inCurrentPeriod(inst: PendingInstance, todayStr: string): boolean {
  const r = inst.recurring_activities?.recurrence;
  if (!r) return false;

  if (r.type !== "frequency") {
    return inst.scheduled_for === todayStr;
  }

  if (r.period === "day") {
    return inst.scheduled_for === todayStr;
  }

  const today = parseDate(todayStr);
  const scheduled = parseDate(inst.scheduled_for);
  const periodStart =
    r.period === "week"
      ? startOfWeek(today, { weekStartsOn: 1 })
      : startOfMonth(today);
  return scheduled >= periodStart && scheduled <= today;
}

function parseDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateLong(yyyyMmDd: string): string {
  const date = parseDate(yyyyMmDd);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
