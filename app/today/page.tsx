// ---------------------------------------------------------------------------
// /today — today's habits + tasks.
//
// Two sections:
//   1. Habits  — pending recurring_activity_instances whose current period
//                includes today (see inCurrentPeriod() below).
//   2. Tasks   — pending tasks. For v1 we show ALL of them sorted by due
//                date (nulls last); finer "actionable today" filtering can
//                land once there's enough data to warrant it.
// ---------------------------------------------------------------------------

import { startOfMonth, startOfWeek } from "date-fns";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { InstanceRow } from "./instance-row";
import { TaskRow } from "./task-row";

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

type PendingTask = {
  id: string;
  name: string;
  description: string | null;
  due_date: string | null;
  earliest_date: string | null;
  priority: number;
};

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Today as YYYY-MM-DD in server TZ. Profile-TZ-aware version lands with
  // the settings page.
  const todayDate = new Date();
  const today = todayDate.toISOString().slice(0, 10);
  const windowStart = new Date(todayDate);
  windowStart.setDate(windowStart.getDate() - 31);
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  // -- Habits --------------------------------------------------------------
  const { data: rawInstances } = await supabase
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

  const allInstances = (rawInstances ?? []) as unknown as PendingInstance[];
  const visibleInstances = allInstances.filter((inst) =>
    inCurrentPeriod(inst, today)
  );

  // -- Tasks ---------------------------------------------------------------
  const { data: rawTasks } = await supabase
    .from("tasks")
    .select("id, name, description, due_date, earliest_date, priority")
    .eq("status", "pending")
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("priority", { ascending: true });

  const tasks = (rawTasks ?? []) as unknown as PendingTask[];

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
        <div className="flex shrink-0 gap-2">
          <Link
            href="/activities/new"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            + Habit
          </Link>
          <Link
            href="/tasks/new"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            + Task
          </Link>
        </div>
      </header>

      <Section title="Habits">
        {visibleInstances.length === 0 ? (
          <EmptyHint
            text="Nothing for today."
            ctaHref="/activities/new"
            ctaText="Add a habit"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {visibleInstances.map((inst) => {
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
      </Section>

      <Section title="Tasks">
        {tasks.length === 0 ? (
          <EmptyHint
            text="No open tasks."
            ctaHref="/tasks/new"
            ctaText="Add a task"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                taskId={t.id}
                name={t.name}
                description={t.description}
                dueDate={t.due_date}
                earliestDate={t.earliest_date}
                priority={t.priority}
                todayStr={today}
              />
            ))}
          </ul>
        )}
      </Section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function EmptyHint({
  text,
  ctaHref,
  ctaText,
}: {
  text: string;
  ctaHref: string;
  ctaText: string;
}) {
  return (
    <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
      {text}{" "}
      <Link
        href={ctaHref}
        className="font-medium underline-offset-2 hover:underline"
      >
        {ctaText}
      </Link>
      .
    </p>
  );
}

function inCurrentPeriod(inst: PendingInstance, todayStr: string): boolean {
  const r = inst.recurring_activities?.recurrence;
  if (!r) return false;
  if (r.type !== "frequency") return inst.scheduled_for === todayStr;
  if (r.period === "day") return inst.scheduled_for === todayStr;

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
