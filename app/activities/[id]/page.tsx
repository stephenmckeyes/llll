// ---------------------------------------------------------------------------
// /activities/[id] — Activity details. Opened by tapping a row on the day
// list. Renders the full activity (so long notes don't get truncated like
// they are on calendar surfaces) and a sticky bottom action bar with
// quick-actions.
//
// When the URL has ?instance=XYZ, the actions know which specific
// occurrence to operate on. That comes through from the day view.
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

import { ActivityActions } from "./activity-actions";

const PRIORITY_LABEL: Record<number, string> = {
  1: "High",
  2: "Medium",
  3: "Low",
};

export default async function ActivityDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ instance?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const { instance: instanceId } = await searchParams;

  const { data: activity } = await supabase
    .from("activities")
    .select(
      "id, name, notes, rhythm, start_date, end_date, priority, default_skill_tags, scheduled_times, archived_at, created_at"
    )
    .eq("id", id)
    .single();

  if (!activity) {
    redirect("/");
  }

  let instance: { id: string; scheduled_for: string; status: string } | null =
    null;
  if (instanceId) {
    const { data } = await supabase
      .from("activity_instances")
      .select("id, scheduled_for, status")
      .eq("id", instanceId)
      .single();
    if (data) instance = data;
  }

  const rhythm = activity.rhythm as Rhythm;
  const isSingle = rhythm.type === "single";

  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col gap-6 p-6 pb-32">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Mission
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="break-words text-3xl font-semibold tracking-tight">
            {activity.name}
          </h1>
          {activity.archived_at && (
            <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              Archived
            </span>
          )}
        </div>
      </header>

      <section className="flex flex-col gap-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <Row label="Rhythm">
          {summarizeRhythm(rhythm, activity.scheduled_times)}
        </Row>
        {activity.scheduled_times.length > 0 && (
          <Row label="Time">
            {summarizeScheduledTimes(activity.scheduled_times)}
          </Row>
        )}
        <Row label={isSingle ? "Scheduled" : "Range"}>
          {summarizeDateRange(
            activity.start_date,
            activity.end_date,
            isSingle
          )}
        </Row>
        <Row label="Priority">{PRIORITY_LABEL[activity.priority] ?? "Medium"}</Row>
        {instance && (
          <Row label="This occurrence">
            {instance.scheduled_for} · {instance.status}
          </Row>
        )}
      </section>

      {activity.notes && (
        <section>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Notes
          </h2>
          <p className="whitespace-pre-wrap break-words text-sm">
            {activity.notes}
          </p>
        </section>
      )}

      {activity.default_skill_tags.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
            Tags
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {activity.default_skill_tags.map((t: string) => (
              <span
                key={t}
                className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
              >
                {t}
              </span>
            ))}
          </div>
        </section>
      )}

      <ActivityActions
        activityId={activity.id}
        instanceId={instance?.id ?? null}
        instanceScheduledFor={instance?.scheduled_for ?? null}
        instanceStatus={instance?.status ?? null}
        archived={!!activity.archived_at}
      />
    </main>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="w-32 shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}
