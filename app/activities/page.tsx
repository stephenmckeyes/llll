// ---------------------------------------------------------------------------
// /activities — manage-all page.
//
// Lists every activity the user owns, split into Active and Archived. v1
// supports Archive / Unarchive. Edit lands in a follow-up (BACKLOG).
// ---------------------------------------------------------------------------

import Link from "next/link";
import { redirect } from "next/navigation";

import {
  summarizeDateRange,
  summarizeRhythm,
  summarizeScheduledTimes,
} from "@/lib/domain/rhythm-summary";
import { createClient } from "@/lib/supabase/server";
import type { Rhythm } from "@/lib/validators/rhythm";

import { ActivityRowActions } from "./row-actions";

type ActivityRow = {
  id: string;
  name: string;
  notes: string | null;
  rhythm: Rhythm;
  start_date: string;
  end_date: string | null;
  priority: number;
  default_skill_tags: string[];
  scheduled_times: string[];
  archived_at: string | null;
  created_at: string;
};

export default async function ActivitiesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("activities")
    .select(
      "id, name, notes, rhythm, start_date, end_date, priority, default_skill_tags, scheduled_times, archived_at, created_at"
    )
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as unknown as ActivityRow[];
  const active = rows.filter((r) => r.archived_at === null);
  const archived = rows.filter((r) => r.archived_at !== null);

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-8 p-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link
            href="/"
            className="text-sm text-zinc-500 underline-offset-2 hover:underline"
          >
            ← Mission
          </Link>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Activities
          </h1>
          <p className="text-sm text-zinc-500">
            {active.length} active · {archived.length} archived
          </p>
        </div>
        <Link
          href="/activities/new"
          className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + Add Activity
        </Link>
      </header>

      <Section title="Active" empty="Nothing active yet.">
        {active.map((a) => (
          <ActivityCard key={a.id} activity={a} />
        ))}
      </Section>

      <Section title="Archived" empty="No archived activities.">
        {archived.map((a) => (
          <ActivityCard key={a.id} activity={a} archived />
        ))}
      </Section>
    </main>
  );
}

// ---------------------------------------------------------------------------

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = (
    Array.isArray(children) ? children : children ? [children] : []
  ) as unknown[];

  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">{children}</ul>
      )}
    </section>
  );
}

function ActivityCard({
  activity,
  archived = false,
}: {
  activity: ActivityRow;
  archived?: boolean;
}) {
  const isSingle = activity.rhythm.type === "single";
  const rhythmLine = summarizeRhythm(
    activity.rhythm,
    activity.scheduled_times
  );
  const rangeLine = summarizeDateRange(
    activity.start_date,
    activity.end_date,
    isSingle
  );
  const timesLine = summarizeScheduledTimes(activity.scheduled_times);

  return (
    <li
      className={`flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-start sm:justify-between ${
        archived
          ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p
            className={`truncate font-medium ${
              archived ? "text-zinc-500 line-through" : ""
            }`}
          >
            {activity.name}
          </p>
          {archived && (
            <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              Archived
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {rhythmLine}
          {timesLine && <span> · {timesLine}</span>}
          <span> · {rangeLine}</span>
        </p>
        {activity.notes && (
          <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-500">
            {activity.notes}
          </p>
        )}
        {activity.default_skill_tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {activity.default_skill_tags.map((t) => (
              <span
                key={t}
                className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
      <ActivityRowActions activityId={activity.id} archived={archived} />
    </li>
  );
}
