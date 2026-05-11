// ---------------------------------------------------------------------------
// Server actions for recurring activities.
// ---------------------------------------------------------------------------

"use server";

import { addDays } from "date-fns";
import { redirect } from "next/navigation";

import { generateInstances } from "@/lib/domain/rhythms";
import { createClient } from "@/lib/supabase/server";
import { rhythmSchema, type Rhythm } from "@/lib/validators/rhythm";

export type ActivityFormState = { error: string } | null;

// Days of pre-generation. Keep small enough that recurrence edits later
// don't strand too many "stale" instances; large enough that the today
// query never has to backfill on its own.
const INSTANCE_HORIZON_DAYS = 30;

export async function createActivity(
  _prev: ActivityFormState,
  formData: FormData
): Promise<ActivityFormState> {
  // ---- 1. Pull + validate the simple fields -------------------------------

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };
  if (name.length > 120) return { error: "Name is too long (max 120)." };

  const descRaw = String(formData.get("description") ?? "").trim();
  const description = descRaw.length === 0 ? null : descRaw;

  // ---- 2. Reconstruct the rhythm object from FormData ---------------------

  const rhythmType = String(formData.get("rhythmType") ?? "daily");
  let candidateRhythm: unknown;

  switch (rhythmType) {
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
        days: Number(formData.get("intervalDays")),
      };
      break;
    case "frequency":
      candidateRhythm = {
        type: "frequency",
        count: Number(formData.get("frequencyCount")),
        period: String(formData.get("frequencyPeriod")),
      };
      break;
    default:
      return { error: `Unknown rhythm type: ${rhythmType}` };
  }

  // ---- 3. Validate the rhythm with Zod (catches empty days arrays, etc.) --

  const parsed = rhythmSchema.safeParse(candidateRhythm);
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Invalid rhythm.",
    };
  }
  const rhythm: Rhythm = parsed.data;

  // ---- 4. Insert the activity (scoped to current user by RLS) -------------

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: activity, error: aerr } = await supabase
    .from("recurring_activities")
    .insert({
      user_id: user.id,
      name,
      description,
      recurrence: rhythm,
    })
    .select("id")
    .single();
  if (aerr || !activity) {
    return { error: aerr?.message ?? "Could not save activity." };
  }

  // ---- 5. Pre-generate instances for the horizon --------------------------
  // Pure function — same inputs always produce the same outputs.

  const today = new Date();
  const horizon = addDays(today, INSTANCE_HORIZON_DAYS);
  const fromStr = today.toISOString().slice(0, 10);
  const toStr = horizon.toISOString().slice(0, 10);

  const instances = generateInstances(rhythm, { from: fromStr, to: toStr });

  if (instances.length > 0) {
    const rows = instances.map((i) => ({
      recurring_activity_id: activity.id,
      scheduled_for: i.scheduledFor,
      status: "pending" as const,
    }));
    const { error: ierr } = await supabase
      .from("recurring_activity_instances")
      .insert(rows);
    if (ierr) {
      // Activity row exists but instances failed. Surface and let the
      // user retry; a follow-up "backfill instances" job will heal these.
      return {
        error: `Activity saved, but generating its schedule failed: ${ierr.message}`,
      };
    }
  }

  redirect("/today");
}
