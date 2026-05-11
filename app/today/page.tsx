// ---------------------------------------------------------------------------
// /today — the daily habit + task list.
// Server Component: reads what's pending for today, renders a clean list.
// Mutations live in client child components that call server actions.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { AddActivityForm } from "./add-activity-form";
import { InstanceRow } from "./instance-row";

type PendingInstance = {
  id: string;
  scheduled_for: string;
  recurring_activities: {
    id: string;
    name: string;
    description: string | null;
  } | null;
};

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Today as a YYYY-MM-DD string. Server-local date for v1; will swap to
  // the user's profile.timezone once that setting is wired up.
  const today = new Date().toISOString().slice(0, 10);

  const { data: pending } = await supabase
    .from("recurring_activity_instances")
    .select(
      `
      id,
      scheduled_for,
      recurring_activities (
        id,
        name,
        description
      )
    `
    )
    .eq("scheduled_for", today)
    .eq("status", "pending")
    .order("scheduled_for");

  const instances = (pending ?? []) as unknown as PendingInstance[];

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-8 p-6">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-500"
        >
          ← Mission
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {formatDateLong(today)}
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Habits
        </h2>
        {instances.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            Nothing scheduled. Add a daily activity below to get started.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {instances.map((inst) => (
              <InstanceRow
                key={inst.id}
                instanceId={inst.id}
                name={inst.recurring_activities?.name ?? "Untitled"}
                description={inst.recurring_activities?.description ?? null}
              />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Add a daily activity
        </h2>
        <AddActivityForm />
        <p className="mt-2 text-xs text-zinc-500">
          v1: only daily rhythms. The full picker (weekdays / interval /
          frequency) lands next.
        </p>
      </section>
    </main>
  );
}

function formatDateLong(yyyyMmDd: string): string {
  // Avoid timezone surprises: parse parts manually rather than via Date().
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
