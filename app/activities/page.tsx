// ---------------------------------------------------------------------------
// /activities — Archive page.
//
// Two collapsible sections, each with its own sort dropdown:
//   1. Archived            — only archived activities (the "trash bin")
//   2. All Activities      — everything (both active and archived) so the
//                            user can browse / re-sort their full list
//                            without leaving this page.
//
// Sort options per section: date created, name, rhythm type, last
// completion. Each section's choice is independently persisted in a
// URL search param (archivedSort / allSort) so deep-links and refreshes
// preserve state.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { redirect } from "next/navigation";

import {
  rhythmCategoryLabel,
  summarizeDateRange,
  summarizeRhythm,
  summarizeScheduledTimes,
} from "@/lib/domain/rhythm-summary";
import { createClient } from "@/lib/supabase/server";
import type { Rhythm } from "@/lib/validators/rhythm";

import { ActivityRowActions } from "./row-actions";
import { SortSelect, type SortKey } from "./sort-select";

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

const VALID_SORTS: ReadonlySet<SortKey> = new Set([
  "created",
  "name",
  "rhythm",
  "lastuse",
]);

function parseSort(raw: string | undefined, fallback: SortKey): SortKey {
  if (raw && VALID_SORTS.has(raw as SortKey)) return raw as SortKey;
  return fallback;
}

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ archivedSort?: string; allSort?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const archivedSort = parseSort(params.archivedSort, "created");
  const allSort = parseSort(params.allSort, "created");

  const { data } = await supabase
    .from("activities")
    .select(
      "id, name, notes, rhythm, start_date, end_date, priority, default_skill_tags, scheduled_times, archived_at, created_at"
    );

  const all = (data ?? []) as unknown as ActivityRow[];
  const archived = all.filter((a) => a.archived_at !== null);

  // ---- last-use map for the "Last completion" sort ----------------------
  // One small query: every completion the user owns, joined to the
  // instance + activity_id, so we can compute MAX(occurred_at) per
  // activity in JS. For typical users this is small; if it ever scales
  // poorly we can switch to a per-activity aggregate RPC.
  const lastUseByActivity = await fetchLastUseByActivity(supabase, user.id);

  const archivedSorted = sortActivities(archived, archivedSort, lastUseByActivity);
  const allSorted = sortActivities(all, allSort, lastUseByActivity);

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-2xl flex-col gap-6 p-6">
      <header>
        <Link
          href="/"
          className="text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Mission
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Archive
        </h1>
        <p className="text-sm text-zinc-500">
          {archived.length} archived · {all.length} total
        </p>
      </header>

      <details open className="rounded-md border border-zinc-200 dark:border-zinc-800">
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
            Archived ({archived.length})
          </span>
          {/* Stop the click on the dropdown from toggling the <details>
              parent — the user is changing sort, not collapsing. */}
          <span onClick={(e) => e.preventDefault()}>
            <SortSelect param="archivedSort" current={archivedSort} />
          </span>
        </summary>
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          {archivedSorted.length === 0 ? (
            <EmptyState text="Nothing archived. Activities you drop from the Calendar / Grid views land here." />
          ) : (
            <ul className="flex flex-col gap-2">
              {archivedSorted.map((a) => (
                <ActivityCard key={a.id} activity={a} archived />
              ))}
            </ul>
          )}
        </div>
      </details>

      <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
            All activities ({all.length})
          </span>
          <span onClick={(e) => e.preventDefault()}>
            <SortSelect param="allSort" current={allSort} />
          </span>
        </summary>
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          {allSorted.length === 0 ? (
            <EmptyState text="No activities yet." />
          ) : (
            <ul className="flex flex-col gap-2">
              {allSorted.map((a) => (
                <ActivityCard
                  key={a.id}
                  activity={a}
                  archived={a.archived_at !== null}
                />
              ))}
            </ul>
          )}
        </div>
      </details>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sorting + data helpers
// ---------------------------------------------------------------------------

function sortActivities(
  rows: ActivityRow[],
  sort: SortKey,
  lastUse: Map<string, string>
): ActivityRow[] {
  // Always sort a copy — never mutate the caller's array.
  const out = [...rows];
  switch (sort) {
    case "name":
      out.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "rhythm":
      out.sort((a, b) => {
        const ra = rhythmCategoryLabel(a.rhythm);
        const rb = rhythmCategoryLabel(b.rhythm);
        if (ra !== rb) return ra.localeCompare(rb);
        return a.name.localeCompare(b.name);
      });
      break;
    case "lastuse":
      out.sort((a, b) => {
        const ua = lastUse.get(a.id) ?? "";
        const ub = lastUse.get(b.id) ?? "";
        // Most recently used first; activities never used go to the
        // bottom (empty string sorts before any timestamp).
        return ub.localeCompare(ua);
      });
      break;
    case "created":
    default:
      // Newest first.
      out.sort((a, b) => b.created_at.localeCompare(a.created_at));
      break;
  }
  return out;
}

async function fetchLastUseByActivity(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<Map<string, string>> {
  // The completion_instances join takes us from completion (which
  // knows when) to activity_id (which knows what). We aggregate in
  // JS rather than via SQL because Supabase JS doesn't expose
  // GROUP BY cleanly without a custom RPC.
  type Row = {
    occurred_at: string;
    completion_instances: Array<{
      activity_instances: { activity_id: string } | null;
    }> | null;
  };
  const { data } = await supabase
    .from("completions")
    .select(
      "occurred_at, completion_instances ( activity_instances ( activity_id ) )"
    )
    .eq("user_id", userId)
    .is("deleted_at", null);

  const map = new Map<string, string>();
  for (const c of (data ?? []) as unknown as Row[]) {
    for (const link of c.completion_instances ?? []) {
      // PostgREST returns nested to-one as either object OR array of one.
      const aiRaw = link.activity_instances as
        | { activity_id: string }
        | Array<{ activity_id: string }>
        | null;
      const ai = Array.isArray(aiRaw) ? aiRaw[0] : aiRaw;
      const activityId = ai?.activity_id;
      if (!activityId) continue;
      const existing = map.get(activityId);
      if (!existing || c.occurred_at > existing) {
        map.set(activityId, c.occurred_at);
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------

function EmptyState({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
      {text}
    </p>
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
