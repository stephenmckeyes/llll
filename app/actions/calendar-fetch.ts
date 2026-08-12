"use server";

// ---------------------------------------------------------------------------
// Endless-scroll Month + Year views need to fetch activity data one
// month / year at a time as the user scrolls new grids into view.
// These server actions return that per-month / per-year data as a
// JSON-safe map the client can drop into its rendering state.
//
// Auth is enforced by requireOnboardedUser (same as the rest of the
// dashboard). Hidden-tag filter is applied server-side so distant
// months don't ship banners for hidden tags the user just wants gone
// from Calendar view.
// ---------------------------------------------------------------------------

import { addDays, endOfMonth, format, startOfMonth, startOfWeek } from "date-fns";

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import type { MonthBanner } from "../_components/month-cell";

// Client-visible return shape: per-cell banner list for the 42-day
// grid, keyed by "YYYY-MM-DD". Missing cells → no activities.
export type MonthBannersByDate = Record<string, MonthBanner[]>;

// Same for Year view — per-day counts, not banners (the mini-month
// cells just render an ink dot when hasActivity, no name).
export type YearCountsByDate = Record<string, { pending: number; completed: number }>;

/** Load a single month's activity banners for the 42-day grid centered
 *  on `monthStart` (any day in the target month works, but callers
 *  should pass the 1st for cache-key stability). */
export async function fetchMonthActivities(
  monthStart: string,
  hiddenTags: string[] = []
): Promise<MonthBannersByDate> {
  const { supabase } = await requireOnboardedUser();

  const refDate = parseDateStr(monthStart);
  const gridStart = startOfWeek(startOfMonth(refDate), { weekStartsOn: 1 });
  const gridEnd = addDays(gridStart, 41);

  const { data } = await supabase
    .from("activity_instances")
    .select(
      "id, scheduled_for, status, tags, activities!inner(name, archived_at, default_skill_tags)"
    )
    .gte("scheduled_for", format(gridStart, "yyyy-MM-dd"))
    .lte("scheduled_for", format(gridEnd, "yyyy-MM-dd"))
    .is("activities.archived_at", null);

  const hiddenSet = new Set(hiddenTags);
  type Row = {
    id: string;
    scheduled_for: string;
    status: string;
    tags: string[] | null;
    activities:
      | { name: string; archived_at: string | null; default_skill_tags: string[] | null }
      | Array<{ name: string; archived_at: string | null; default_skill_tags: string[] | null }>
      | null;
  };
  const result: MonthBannersByDate = {};
  for (const r of (data ?? []) as Row[]) {
    const act = Array.isArray(r.activities) ? r.activities[0] : r.activities;
    if (!act) continue;
    const defaults = act.default_skill_tags ?? [];
    // Hidden-tag filter: an activity's DEFAULT tags decide whether it
    // shows in Calendar. Matches keepForCalendar in page.tsx.
    if (hiddenSet.size > 0 && defaults.some((t) => hiddenSet.has(t))) continue;
    (result[r.scheduled_for] ??= []).push({
      id: r.id,
      name: act.name,
      status: r.status,
      tags: r.tags ?? [],
    });
  }
  return result;
}

/** Load a single year's per-day activity counts. Year view only needs
 *  presence + completed-count for mini-cell coloring, not names. */
export async function fetchYearActivities(
  yearStart: string,
  hiddenTags: string[] = []
): Promise<YearCountsByDate> {
  const { supabase } = await requireOnboardedUser();

  // yearStart is expected to be YYYY-01-01 (client sends first of year).
  const year = Number(yearStart.slice(0, 4));
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const { data } = await supabase
    .from("activity_instances")
    .select(
      "scheduled_for, status, activities!inner(archived_at, default_skill_tags)"
    )
    .gte("scheduled_for", from)
    .lte("scheduled_for", to)
    .is("activities.archived_at", null);

  const hiddenSet = new Set(hiddenTags);
  type Row = {
    scheduled_for: string;
    status: string;
    activities:
      | { archived_at: string | null; default_skill_tags: string[] | null }
      | Array<{ archived_at: string | null; default_skill_tags: string[] | null }>
      | null;
  };
  const result: YearCountsByDate = {};
  for (const r of (data ?? []) as Row[]) {
    const act = Array.isArray(r.activities) ? r.activities[0] : r.activities;
    if (!act) continue;
    const defaults = act.default_skill_tags ?? [];
    if (hiddenSet.size > 0 && defaults.some((t) => hiddenSet.has(t))) continue;
    const bucket = (result[r.scheduled_for] ??= { pending: 0, completed: 0 });
    if (r.status === "pending") bucket.pending += 1;
    else if (r.status === "completed") bucket.completed += 1;
  }
  return result;
}

// Local parse — imported date-fns's parseISO uses UTC midnight which
// drifts by a day in western time zones. We only need the y/m/d.
function parseDateStr(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d);
}
