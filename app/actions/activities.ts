// ---------------------------------------------------------------------------
// Server actions for activities (the unified producer).
// ---------------------------------------------------------------------------

"use server";

import { addDays } from "date-fns";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { z } from "zod";

import { logCompletion } from "@/lib/domain/completions";
import { generateInstances } from "@/lib/domain/rhythms";
import { createClient } from "@/lib/supabase/server";
import {
  remindersSchema,
  type Reminder,
} from "@/lib/validators/reminder";
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
      // For Multi-Daily the count is derived from the number of time-of-day
      // entries the user supplied (one per occurrence).
      candidateRhythm = {
        type: "frequency",
        count: Math.max(
          1,
          formData
            .getAll("scheduledTime")
            .map(String)
            .filter((s) => /^\d{2}:\d{2}$/.test(s)).length
        ),
        perCount: 1,
        perUnit: "days",
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
        count: clampInt(formData.get("frequencyCount"), 1, 99, 3),
        perCount: clampInt(formData.get("frequencyPerCount"), 1, 99, 1),
        perUnit: String(formData.get("frequencyPerUnit") ?? "weeks"),
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

  // ---- 4. Scheduled times (HH:MM strings) ---------------------------------
  // Multi-Daily: one entry per time the user added (count was derived above).
  // Other rhythms: 0 or 1 entries (the optional single time field).

  const scheduledTimes = formData
    .getAll("scheduledTime")
    .map(String)
    .filter((s) => /^\d{2}:\d{2}$/.test(s));

  // ---- 4b. Reminders (zip parallel arrays from the form) ------------------

  const reminders = parseRemindersFromForm(formData);
  const remindersValidated = remindersSchema.safeParse(reminders);
  if (!remindersValidated.success) {
    return { error: "One of the reminders is invalid." };
  }

  // ---- 5. Insert activity --------------------------------------------------

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
      scheduled_times: scheduledTimes,
      reminders: remindersValidated.data,
    })
    .select("id")
    .single();

  if (aerr || !activity) {
    return { error: aerr?.message ?? "Could not save activity." };
  }

  // ---- 6. Pre-generate instances ------------------------------------------
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

  redirect("/");
}

// ---------------------------------------------------------------------------
// completeInstance — wraps logCompletion() for the day-list tap on home.
// ---------------------------------------------------------------------------

export async function completeInstance(instanceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await logCompletion(supabase, user.id, { instanceIds: [instanceId] });
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// setInstanceProgress — set the completion count for an instance to a
// specific number, then sync status. Used by the editable X/Y badge on
// frequency rows (for "I miss-clicked +1" undo, or "I did 3 of them at
// once, mark them all done" mass-fill).
//
// Implementation:
//   - delta > 0 → add new completions through logCompletion (so XP/streaks
//     hooks still run when we add them).
//   - delta < 0 → delete the most recent N completions linked to this
//     instance. completion_instances rows cascade. History for OTHER
//     instances is unaffected.
// ---------------------------------------------------------------------------

export async function setInstanceProgress(
  instanceId: string,
  targetCount: number
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const safeTarget = Math.max(0, Math.floor(targetCount));

  // Existing links, most-recent-first (we'll trim from the top if removing).
  const { data: links } = await supabase
    .from("completion_instances")
    .select("completion_id, created_at")
    .eq("instance_id", instanceId)
    .order("created_at", { ascending: false });

  const current = links?.length ?? 0;
  const delta = safeTarget - current;

  if (delta > 0) {
    for (let i = 0; i < delta; i++) {
      await logCompletion(supabase, user.id, { instanceIds: [instanceId] });
    }
  } else if (delta < 0) {
    const toDelete = (links ?? [])
      .slice(0, -delta)
      .map((l) => l.completion_id as string);
    if (toDelete.length > 0) {
      // Delete the completions themselves; the link rows cascade.
      await supabase.from("completions").delete().in("id", toDelete);
    }
  }

  // Sync the instance status against the activity's target.
  const { data: inst } = await supabase
    .from("activity_instances")
    .select("activities ( rhythm )")
    .eq("id", instanceId)
    .single();
  const rhythm = (
    inst as { activities?: { rhythm?: { type?: string; count?: number } } } | null
  )?.activities?.rhythm;
  const target = rhythm?.type === "frequency" ? rhythm.count ?? 1 : 1;
  const newStatus = safeTarget >= target ? "completed" : "pending";

  await supabase
    .from("activity_instances")
    .update({ status: newStatus })
    .eq("id", instanceId);

  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// archiveActivity — soft-delete. The row stays for history; today/week
// queries filter on archived_at IS NULL so it disappears from active
// surfaces. RLS already scopes to the owning user.
// ---------------------------------------------------------------------------

export async function archiveActivity(activityId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase
    .from("activities")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", activityId);

  revalidatePath("/");
  revalidatePath("/activities");
}

// ---------------------------------------------------------------------------
// updateActivity — partial update for an existing activity. v1 covers the
// fields that DON'T change the schedule (name, notes, tags, priority). The
// schedule fields (rhythm, start_date, end_date, scheduled_times) ship in
// a follow-up turn together with the future-instance regeneration logic;
// touching them today without regeneration would leave the activity row
// disagreeing with its generated activity_instances.
// ---------------------------------------------------------------------------

export type UpdateActivityState = { error: string } | { ok: true } | null;

const editFieldsSchema = z
  .object({
    name: z.string().trim().min(1, "Name can't be empty.").max(120),
    notes: z.string().trim().max(500),
    tags: z.string().trim().max(300),
    priority: z.number().int().min(1).max(3),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (d) => !d.endDate || d.endDate >= d.startDate,
    { error: "End date must be on or after the start date." }
  );

export async function updateActivityFields(
  activityId: string,
  _prev: UpdateActivityState,
  formData: FormData
): Promise<UpdateActivityState> {
  const endDateRaw = String(formData.get("endDate") ?? "").trim();
  const parsed = editFieldsSchema.safeParse({
    name: formData.get("name"),
    notes: formData.get("notes") ?? "",
    tags: formData.get("tags") ?? "",
    priority: Number(formData.get("priority") ?? 2),
    startDate: formData.get("startDate"),
    endDate: endDateRaw.length > 0 ? endDateRaw : undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const tags = parsed.data.tags
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const reminders = parseRemindersFromForm(formData);
  const remindersValidated = remindersSchema.safeParse(reminders);
  if (!remindersValidated.success) {
    return { error: "One of the reminders is invalid." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const newEndDate = parsed.data.endDate ?? null;

  const { error } = await supabase
    .from("activities")
    .update({
      name: parsed.data.name,
      notes: parsed.data.notes.length === 0 ? null : parsed.data.notes,
      default_skill_tags: tags,
      priority: parsed.data.priority,
      start_date: parsed.data.startDate,
      end_date: newEndDate,
      reminders: remindersValidated.data,
    })
    .eq("id", activityId);

  if (error) return { error: error.message };

  // Keep generated instances in sync with the new date range. We only
  // touch *pending* instances — completions stay in history regardless.
  // - If end_date moved earlier: drop pending instances past it.
  // - If start_date moved later: drop pending instances before it.
  // Rhythm changes (which can require regeneration mid-range) ship in the
  // dedicated edit-rhythm turn.
  if (newEndDate) {
    await supabase
      .from("activity_instances")
      .delete()
      .eq("activity_id", activityId)
      .eq("status", "pending")
      .gt("scheduled_for", newEndDate);
  }
  await supabase
    .from("activity_instances")
    .delete()
    .eq("activity_id", activityId)
    .eq("status", "pending")
    .lt("scheduled_for", parsed.data.startDate);

  revalidatePath("/");
  revalidatePath("/activities");
  revalidatePath(`/activities/${activityId}`);
  return { ok: true };
}

export async function unarchiveActivity(activityId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase
    .from("activities")
    .update({ archived_at: null })
    .eq("id", activityId);

  revalidatePath("/");
  revalidatePath("/activities");
}

// ---------------------------------------------------------------------------
// missInstance — flip the instance status to 'missed'. No completion row
// is created. The button is labeled "Missed" in the UI; semantically the
// user is acknowledging they didn't do this occurrence. (Phase 2c+ could
// add a separate "skip" action if the user wants to distinguish "missed
// by accident" from "intentionally skipped.")
// ---------------------------------------------------------------------------

export async function missInstance(instanceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase
    .from("activity_instances")
    .update({ status: "missed" })
    .eq("id", instanceId);

  revalidatePath("/");
}

// Kept as an alias for any older imports while we transition. UI no
// longer calls this; safe to delete in a follow-up cleanup.
export async function skipInstance(instanceId: string) {
  return missInstance(instanceId);
}

// ---------------------------------------------------------------------------
// deleteActivity — PERMANENT hard delete. Cascading FKs wipe instances and
// linked completions. Only allowed for already-archived rows; the UI in
// /activities exposes this only in the Archived section, by design.
// ---------------------------------------------------------------------------

export async function deleteActivity(activityId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Belt-and-suspenders: verify the row is already archived before deleting.
  const { data: a } = await supabase
    .from("activities")
    .select("archived_at")
    .eq("id", activityId)
    .single();
  if (!a || !a.archived_at) {
    // Refuse to delete a non-archived activity. UI should never trigger
    // this path, but if it does, fail silently rather than vaporize data.
    return;
  }

  await supabase.from("activities").delete().eq("id", activityId);

  revalidatePath("/activities");
  revalidatePath("/");
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

// ---------------------------------------------------------------------------
// Form-data → reminders[]. The UI renders parallel reminderDays,
// reminderHours, reminderMinutes fields, one trio per reminder row. We zip
// them by index and drop any row whose total duration is zero.
// ---------------------------------------------------------------------------

function parseRemindersFromForm(formData: FormData): Reminder[] {
  const days = formData.getAll("reminderDays");
  const hours = formData.getAll("reminderHours");
  const mins = formData.getAll("reminderMinutes");
  const n = Math.min(days.length, hours.length, mins.length);
  const out: Reminder[] = [];
  for (let i = 0; i < n; i++) {
    const d = clampFormInt(days[i], 0, 30);
    const h = clampFormInt(hours[i], 0, 23);
    const m = clampFormInt(mins[i], 0, 59);
    if (d + h + m === 0) continue; // drop empty rows
    out.push({ days: d, hours: h, minutes: m });
  }
  return out;
}

function clampFormInt(
  v: FormDataEntryValue,
  min: number,
  max: number
): number {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}
