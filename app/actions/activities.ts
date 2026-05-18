// ---------------------------------------------------------------------------
// Server actions for activities (the unified producer).
// ---------------------------------------------------------------------------

"use server";

import { addDays } from "date-fns";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { z } from "zod";

import { invalidateBackfillCache } from "@/lib/domain/backfill";
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
    case "selection":
      // Selection fans out into N independent single activities below.
      // The rhythm shape stored on each row is plain `{type: "single"}`
      // — there's no special "selection" rhythm at the database level.
      // The bundling exists only in this form submission, not in
      // storage. Each spawned activity is afterwards indistinguishable
      // from a "Once" activity created on its own.
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
  // Selection submits MULTIPLE `startDate` form values — one per picked
  // date. For every other rhythm there's exactly one. We normalize into
  // a `startDates: string[]` list and fan out below.

  const todayStr = new Date().toISOString().slice(0, 10);
  const isSelection = rhythmType === "selection";
  const startDates = isSelection
    ? Array.from(
        new Set(
          formData
            .getAll("startDate")
            .map(parseDateField)
            .filter((v): v is string => v !== null)
        )
      ).sort()
    : [parseDateField(formData.get("startDate")) ?? todayStr];

  if (isSelection && startDates.length === 0) {
    return {
      error:
        "Selection needs at least one date — pick a start date or add one.",
    };
  }

  // For non-selection singles, end_date := start_date. For selection,
  // each fanned-out activity follows the same rule (handled in the loop
  // below). All other rhythms get the optional end_date from the form.
  let endDate: string | null;
  if (rhythm.type === "single") {
    endDate = null; // per-activity end_date set in the loop below
  } else {
    endDate = parseDateField(formData.get("endDate"));
    // Validate against the primary start date for non-selection cases;
    // selection always has end_date == that loop iteration's start_date.
    if (endDate && endDate < startDates[0]) {
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

  // ---- 5+6. Insert + pre-generate instances ------------------------------
  // For non-selection: one iteration with the form's single start date.
  // For Unrhythmic Selection: one iteration per picked date — each
  // produces an independent `{type:"single"}` activity sharing every
  // other field. Once stored, the spawned activities are
  // indistinguishable from "Once" activities created individually.

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  for (const startDate of startDates) {
    const perActivityEndDate =
      rhythm.type === "single" ? startDate : endDate;

    const { data: activity, error: aerr } = await supabase
      .from("activities")
      .insert({
        user_id: user.id,
        name,
        notes,
        rhythm,
        start_date: startDate,
        end_date: perActivityEndDate,
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

    const horizonStr = addDays(parseISODate(startDate), INSTANCE_HORIZON_DAYS)
      .toISOString()
      .slice(0, 10);
    const generationTo =
      perActivityEndDate !== null && perActivityEndDate < horizonStr
        ? perActivityEndDate
        : horizonStr;

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
  }

  // New activity = new generation work that backfill will need to do for any
  // far-future view. Reset the per-user throttle so it runs immediately.
  invalidateBackfillCache(user.id);

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
  invalidateBackfillCache(user.id);
  revalidatePath("/");
}

// ---------------------------------------------------------------------------
// updateActivityRhythm — change an activity's rhythm + scheduled_times
// mid-life. Past instances + their completions are PRESERVED (design doc
// rule: never mutate history). Pending future instances are wiped and
// re-generated from today using the new rhythm.
// ---------------------------------------------------------------------------

export type UpdateActivityRhythmState =
  | { error: string }
  | { ok: true }
  | null;

export async function updateActivityRhythm(
  activityId: string,
  _prev: UpdateActivityRhythmState,
  formData: FormData
): Promise<UpdateActivityRhythmState> {
  // ---- 1. Reconstruct + validate the rhythm (same parser as create) ------

  const rhythmType = String(formData.get("rhythmType") ?? "single");
  let candidateRhythm: unknown;
  switch (rhythmType) {
    case "single":
      candidateRhythm = { type: "single" };
      break;
    case "multi_daily":
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
  const newRhythm: Rhythm = parsed.data;

  // ---- 2. Scheduled times -------------------------------------------------

  const scheduledTimes = formData
    .getAll("scheduledTime")
    .map(String)
    .filter((s) => /^\d{2}:\d{2}$/.test(s));

  // ---- 3. Auth + fetch the activity (need start_date, end_date) ----------

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: existing, error: ferr } = await supabase
    .from("activities")
    .select("start_date, end_date")
    .eq("id", activityId)
    .single();
  if (ferr || !existing) {
    return { error: ferr?.message ?? "Activity not found." };
  }

  // ---- 4. Persist the new rhythm + times ---------------------------------

  const { error: uerr } = await supabase
    .from("activities")
    .update({
      rhythm: newRhythm,
      scheduled_times: scheduledTimes,
    })
    .eq("id", activityId);
  if (uerr) return { error: uerr.message };

  // ---- 5. Wipe pending future instances ----------------------------------

  const todayStr = new Date().toISOString().slice(0, 10);
  await supabase
    .from("activity_instances")
    .delete()
    .eq("activity_id", activityId)
    .eq("status", "pending")
    .gte("scheduled_for", todayStr);

  // ---- 6. Regenerate from max(today, start_date) up to horizon ------------

  const startDate =
    existing.start_date > todayStr ? existing.start_date : todayStr;
  const horizonStr = addDays(
    parseISODate(startDate),
    INSTANCE_HORIZON_DAYS
  )
    .toISOString()
    .slice(0, 10);
  const endDate = existing.end_date;
  const generationTo =
    endDate !== null && endDate < horizonStr ? endDate : horizonStr;

  const instances = generateInstances(newRhythm, {
    from: startDate,
    to: generationTo,
  });
  if (instances.length > 0) {
    const rows = instances.map((i) => ({
      activity_id: activityId,
      scheduled_for: i.scheduledFor,
      status: "pending" as const,
    }));
    await supabase.from("activity_instances").insert(rows);
  }

  // Rhythm change ⇒ generation rules change ⇒ throttle must reset so the
  // next view paints from the new rhythm immediately, not in an hour.
  invalidateBackfillCache(user.id);

  revalidatePath("/");
  revalidatePath("/activities");
  revalidatePath(`/activities/${activityId}`);
  return { ok: true };
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

  invalidateBackfillCache(user.id);
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

  // Archived activities are excluded from backfill — drop the cache so the
  // next page-load doesn't keep extending an activity the user just hid.
  invalidateBackfillCache(user.id);
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

  // Date-range edits change what backfill needs to extend; force the next
  // page-load to recompute instead of waiting an hour.
  invalidateBackfillCache(user.id);

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

  // Re-included in the active set ⇒ backfill needs to re-extend it.
  invalidateBackfillCache(user.id);
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

  invalidateBackfillCache(user.id);
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

  invalidateBackfillCache(user.id);
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
    out.push({
      days: clampFormInt(days[i], 0, 30),
      hours: clampFormInt(hours[i], 0, 23),
      minutes: clampFormInt(mins[i], 0, 59),
    });
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
