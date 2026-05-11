// ---------------------------------------------------------------------------
// Server actions for activities (the unified producer).
// ---------------------------------------------------------------------------

"use server";

import { addDays } from "date-fns";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logCompletion } from "@/lib/domain/completions";
import { generateInstances } from "@/lib/domain/rhythms";
import { createClient } from "@/lib/supabase/server";
import { rhythmSchema, type Rhythm } from "@/lib/validators/rhythm";

export type ActivityFormState = { error: string } | null;

// How many days of instances to generate up front. Far enough that the
// today view rarely needs to backfill; small enough that recurrence edits
// don't strand many "stale" future instances.
const INSTANCE_HORIZON_DAYS = 30;

// ---------------------------------------------------------------------------
// createActivity — insert one activity + pre-generate its instances.
// ---------------------------------------------------------------------------

export async function createActivity(
  _prev: ActivityFormState,
  formData: FormData
): Promise<ActivityFormState> {
  // ---- 1. Simple fields ---------------------------------------------------

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Activity name is required." };
  if (name.length > 120) return { error: "Name is too long (max 120)." };

  const notesRaw = String(formData.get("notes") ?? "").trim();
  const notes = notesRaw.length === 0 ? null : notesRaw;

  const tagsRaw = String(formData.get("tags") ?? "").trim();
  const tags = tagsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // priority is only meaningful (and shown) for "single"; default = medium.
  const priority = clampInt(formData.get("priority"), 1, 3, 2);

  // ---- 2. Reconstruct + validate the rhythm -------------------------------

  const rhythmType = String(formData.get("rhythmType") ?? "single");
  let candidateRhythm: unknown;
  switch (rhythmType) {
    case "single":
      candidateRhythm = { type: "single" };
      break;
    case "multi_daily":
      candidateRhythm = {
        type: "frequency",
        count: clampInt(formData.get("multiDailyCount"), 1, 50, 2),
        period: "day",
      };
      break;
    case "daily":
      candidateRhythm = { type: "daily" };
      break;
    case "weekdays":
      candidateRhythm = {
        type: "weekdays",
        days: formData.getAll("weekday").map(String),
      };
      break;
    case "interval":
      candidateRhythm = {
        type: "interval",
        days: clampInt(formData.get("intervalDays"), 1, 365, 2),
      };
      break;
    case "frequency":
      candidateRhythm = {
        type: "frequency",
        count: clampInt(formData.get("frequencyCount"), 1, 50, 3),
        period: String(formData.get("frequencyPeriod") ?? "week"),
      };
      break;
    default:
      return { error: `Unknown rhythm type: ${rhythmType}` };
  }

  const parsed = rhythmSchema.safeParse(candidateRhythm);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid rhythm." };
  }
  const rhythm: Rhythm = parsed.data;

  // ---- 3. Schedule range (start_date, end_date) ---------------------------

  const todayStr = new Date().toISOString().slice(0, 10);
  const startDate = parseDateField(formData.get("startDate")) ?? todayStr;

  // Singles: end_date := start_date (window of one day). All others:
  // optional end_date; null = open-ended.
  let endDate: string | null;
  if (rhythm.type === "single") {
    endDate = startDate;
  } else {
    endDate = parseDateField(formData.get("endDate"));
    if (endDate && endDate < startDate) {
      return { error: "End date must be on or after the start date." };
    }
  }

  // ---- 4. Insert activity --------------------------------------------------

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: activity, error: aerr } = await supabase
    .from("activities")
    .insert({
      user_id: user.id,
      name,
      notes,
      rhythm,
      start_date: startDate,
      end_date: endDate,
      priority,
      default_skill_tags: tags,
    })
    .select("id")
    .single();

  if (aerr || !activity) {
    return { error: aerr?.message ?? "Could not save activity." };
  }

  // ---- 5. Pre-generate instances ------------------------------------------
  // Window: from start_date up to min(start_date + 30 days, end_date).
  // generateInstances is pure; same inputs → same outputs.

  const horizonStr = addDays(parseISODate(startDate), INSTANCE_HORIZON_DAYS)
    .toISOString()
    .slice(0, 10);
  const generationTo =
    endDate !== null && endDate < horizonStr ? endDate : horizonStr;

  const instances = generateInstances(rhythm, {
    from: startDate,
    to: generationTo,
  });

  if (instances.length > 0) {
    const rows = instances.map((i) => ({
      activity_id: activity.id,
      scheduled_for: i.scheduledFor,
      status: "pending" as const,
    }));
    const { error: ierr } = await supabase
      .from("activity_instances")
      .insert(rows);
    if (ierr) {
      return {
        error: `Activity saved, but generating its schedule failed: ${ierr.message}`,
      };
    }
  }

  redirect("/today");
}

// ---------------------------------------------------------------------------
// completeInstance — wraps logCompletion() for the today-list tap.
// ---------------------------------------------------------------------------

export async function completeInstance(instanceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await logCompletion(supabase, user.id, { instanceIds: [instanceId] });
  revalidatePath("/today");
}

// ---------------------------------------------------------------------------

function clampInt(
  value: FormDataEntryValue | null,
  min: number,
  max: number,
  fallback: number
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

function parseDateField(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseISODate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
