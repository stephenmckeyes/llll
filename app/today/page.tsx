// ---------------------------------------------------------------------------
// /today — today's activities (one unified list, no more habits-vs-tasks).
//
// Visibility rules for the list:
//   - single rhythm:    show on its scheduled_for AND every day after until
//                       completed (overdue handling).
//   - daily / weekdays / interval / frequency-day:
//                       show only when scheduled_for == today.
//   - frequency week:   show every day where scheduled_for falls in this
//                       Monday-anchored week.
//   - frequency month:  show every day in the current calendar month.
// ---------------------------------------------------------------------------

import { startOfMonth, startOfWeek } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { InstanceRow } from "./instance-row";

type Rhythm =
  | { type: "single" }
  | { type: "daily" }
  | { type: "weekdays"; days: string[] }
  | { type: "interval"; days: number }
  | { type: "frequency"; count: number; period: "day" | "week" | "month" };

type PendingInstance = {
  id: string;
  scheduled_for: string;
  activities: {
    id: string;
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    priority: number;
    end_date: string | null;
    scheduled_times: string[];
  } | null;
  completion_instances: Array<{ completion_id: string }> | null;
};

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const today = new Date().toISOString().slice(0, 10);
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - 60); // wide enough for overdue singles
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("activity_instances")
    .select(
      `
      id,
      scheduled_for,
      activities (
        id,
        name,
        notes,
        rhythm,
        priority,
        end_date,
        scheduled_times
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
  const visible = raw
    .filter((inst) => visibleOnToday(inst, today))
    .sort(compareForToday);

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
          + Add Activity
        </Link>
      </header>

      <section>
        {visible.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Nothing for today.{" "}
            <Link
              href="/activities/new"
              className="font-medium underline-offset-2 hover:underline"
            >
              Add your first activity
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((inst) => {
              const r = inst.activities?.rhythm;
              const isFrequency = r?.type === "frequency";
              const isSingle = r?.type === "single";
              return (
                <InstanceRow
                  key={inst.id}
                  instanceId={inst.id}
                  name={inst.activities?.name ?? "Untitled"}
                  notes={inst.activities?.notes ?? null}
                  priority={inst.activities?.priority ?? 2}
                  scheduledFor={inst.scheduled_for}
                  scheduledTimes={inst.activities?.scheduled_times ?? []}
                  todayStr={today}
                  isSingle={isSingle ?? false}
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

// ---------------------------------------------------------------------------

function visibleOnToday(inst: PendingInstance, todayStr: string): boolean {
  const r = inst.activities?.rhythm;
  if (!r) return false;

  if (r.type === "single") {
    return inst.scheduled_for <= todayStr; // today OR overdue
  }

  if (r.type !== "frequency") {
    return inst.scheduled_for === todayStr;
  }

  if (r.period === "day") return inst.scheduled_for === todayStr;

  const today = parseDate(todayStr);
  const scheduled = parseDate(inst.scheduled_for);
  const periodStart =
    r.period === "week"
      ? startOfWeek(today, { weekStartsOn: 1 })
      : startOfMonth(today);
  return scheduled >= periodStart && scheduled <= today;
}

/** Overdue singles first, then by priority (1=high), then by name. */
function compareForToday(a: PendingInstance, b: PendingInstance): number {
  const aOverdue = a.activities?.rhythm.type === "single" && a.scheduled_for < todayStrCache();
  const bOverdue = b.activities?.rhythm.type === "single" && b.scheduled_for < todayStrCache();
  if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;

  const pa = a.activities?.priority ?? 2;
  const pb = b.activities?.priority ?? 2;
  if (pa !== pb) return pa - pb;

  return (a.activities?.name ?? "").localeCompare(b.activities?.name ?? "");
}

let _todayCache: string | null = null;
function todayStrCache(): string {
  if (_todayCache === null) {
    _todayCache = new Date().toISOString().slice(0, 10);
  }
  return _todayCache;
}

function parseDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateLong(yyyyMmDd: string): string {
  return parseDate(yyyyMmDd).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
