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

  // Tags now come from the TagPicker as one hidden <input name="tag">
  // per selected tag (was: a single comma-separated `name="tags"`
  // text input). Deduplicate to be safe in case the picker ever emits
  // a duplicate name.
  const tags = Array.from(
    new Set(
      formData
        .getAll("tag")
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );

  // priority is only meaningful (and shown) for "single"; default = medium.
  const priority = clampInt(formData.get("priority"), 1, 3, 2);

  // Grid display flag (migration 0016). Default false ("don't track on grid").
  const trackOnGrid = String(formData.get("trackOnGrid")) === "true";

  // ---- 2. Reconstruct + validate the rhythm -------------------------------

  const rhythmType = String(formData.get("rhythmType") ?? "single");
  // Multi-time daily activities still need to read like the old
  // "Multi-Daily" rhythm so the X/Y progress UI on the Day list works.
  // We count valid HH:MM entries up-front and convert daily+multi to a
  // frequency rhythm below; other rhythms keep their times in
  // scheduled_times[] and surface "Multi" via rhythmCategoryLabel only.
  const validScheduledTimeCount = formData
    .getAll("scheduledTime")
    .map(String)
    .filter((s) => /^\d{2}:\d{2}$/.test(s)).length;
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
    case "daily":
      // Daily with multiple times of day → store as frequency (count =
      // number of times, period = 1 day) so the existing per-instance
      // X/Y progress UI handles "did I do all N today?". Single-time
      // daily stays a plain `{type: "daily"}`.
      if (validScheduledTimeCount > 1) {
        candidateRhythm = {
          type: "frequency",
          count: validScheduledTimeCount,
          perCount: 1,
          perUnit: "days",
        };
      } else {
        candidateRhythm = { type: "daily" };
      }
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
        track_on_grid: trackOnGrid,
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
      // Snapshot the activity's tags into each freshly-generated
      // instance. From here on, Edit Activity changes to
      // `default_skill_tags` will NOT affect this instance —
      // it owns its own tag copy.
      const rows = instances.map((i) => ({
        activity_id: activity.id,
        scheduled_for: i.scheduledFor,
        status: "pending" as const,
        tags,
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
// createDraftActivity — "Save for later". Stashes an activity in the
// archive WITHOUT putting it on any calendar. Because it generates no
// instances, it can be saved with incomplete details: only a NAME is
// required. The rest is best-effort (an invalid rhythm falls back to
// "Once", malformed reminders are dropped). The user finishes + activates
// it later via Unarchive, which re-validates everything through the normal
// edit form before it goes live. No backfill impact (archived rows are
// never generated), so we don't touch the backfill cache.
// ---------------------------------------------------------------------------

export async function createDraftActivity(
  _prev: ActivityFormState,
  formData: FormData
): Promise<ActivityFormState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Give your draft a name so you can find it later." };
  }
  if (name.length > 120) return { error: "Name is too long (max 120)." };

  const notesRaw = String(formData.get("notes") ?? "").trim();
  const notes = notesRaw.length === 0 ? null : notesRaw;

  const tags = Array.from(
    new Set(
      formData
        .getAll("tag")
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );

  const priority = clampInt(formData.get("priority"), 1, 3, 2);

  const scheduledTimes = formData
    .getAll("scheduledTime")
    .map(String)
    .filter((s) => /^\d{2}:\d{2}$/.test(s));

  // Best-effort rhythm — a draft doesn't have to be a valid schedule yet.
  const rhythm = buildDraftRhythm(formData, scheduledTimes);

  // Dates are optional for a draft. Default start to today; pin a single's
  // end to its start so the row stays coherent if unarchived unchanged.
  const todayStr = new Date().toISOString().slice(0, 10);
  const startDate = parseDateField(formData.get("startDate")) ?? todayStr;
  const endDate =
    rhythm.type === "single"
      ? startDate
      : parseDateField(formData.get("endDate"));

  // Reminders best-effort: keep if valid, else drop — a draft must never
  // fail to save over a malformed reminder.
  const remindersParsed = remindersSchema.safeParse(
    parseRemindersFromForm(formData)
  );
  const reminders = remindersParsed.success ? remindersParsed.data : [];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("activities").insert({
    user_id: user.id,
    name,
    notes,
    rhythm,
    start_date: startDate,
    end_date: endDate,
    priority,
    default_skill_tags: tags,
    scheduled_times: scheduledTimes,
    reminders,
    track_on_grid: String(formData.get("trackOnGrid")) === "true",
    // The whole point: parked in the archive, generating no instances.
    archived_at: new Date().toISOString(),
  });
  if (error) return { error: error.message };

  revalidatePath("/activities");
  redirect("/activities");
}

// Build a best-effort Rhythm from the form for a draft. Mirrors the rhythm
// switch in createActivity, but never throws: anything that doesn't parse
// degrades to a plain "Once" so the draft always saves.
function buildDraftRhythm(
  formData: FormData,
  scheduledTimes: string[]
): Rhythm {
  const rhythmType = String(formData.get("rhythmType") ?? "single");
  let candidate: unknown;
  switch (rhythmType) {
    case "daily":
      candidate =
        scheduledTimes.length > 1
          ? {
              type: "frequency",
              count: scheduledTimes.length,
              perCount: 1,
              perUnit: "days",
            }
          : { type: "daily" };
      break;
    case "weekdays":
      candidate = {
        type: "weekdays",
        days: formData.getAll("weekday").map(String),
      };
      break;
    case "interval":
      candidate = {
        type: "interval",
        days: clampInt(formData.get("intervalDays"), 1, 365, 2),
      };
      break;
    case "frequency":
      candidate = {
        type: "frequency",
        count: clampInt(formData.get("frequencyCount"), 1, 99, 3),
        perCount: clampInt(formData.get("frequencyPerCount"), 1, 99, 1),
        perUnit: String(formData.get("frequencyPerUnit") ?? "weeks"),
      };
      break;
    default:
      candidate = { type: "single" };
  }
  const parsed = rhythmSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { type: "single" };
}

// ---------------------------------------------------------------------------
// createQuickSingle — used by the day calendar's inline "+ Add activity"
// field. Creates a one-off (rhythm: single) activity for the given date with
// safe defaults (no time, no tags, no reminders, priority medium, not on
// grid) so the user can capture a name in one keystroke and tap off / hit
// Enter. The "i" button on that row opens the full NewActivityModal instead.
// ---------------------------------------------------------------------------

export async function createQuickSingle(
  name: string,
  dateStr: string
): Promise<{ error: string } | { ok: true }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the activity a name first." };
  if (trimmed.length > 120) return { error: "Name is too long (max 120)." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { error: "Invalid date." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: act, error: aerr } = await supabase
    .from("activities")
    .insert({
      user_id: user.id,
      name: trimmed,
      notes: null,
      rhythm: { type: "single" },
      start_date: dateStr,
      end_date: dateStr,
      priority: 2,
      default_skill_tags: [],
      scheduled_times: [],
      reminders: [],
      track_on_grid: false,
    })
    .select("id")
    .single();
  if (aerr || !act) {
    return { error: aerr?.message ?? "Could not save activity." };
  }

  const { error: ierr } = await supabase.from("activity_instances").insert({
    activity_id: act.id,
    scheduled_for: dateStr,
    status: "pending" as const,
    tags: [],
  });
  if (ierr) {
    return {
      error: `Activity saved, but generating the day failed: ${ierr.message}`,
    };
  }

  invalidateBackfillCache(user.id);
  revalidatePath("/");
  return { ok: true };
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
  // PERF: this action ONLY persists — it does NOT revalidatePath. The
  // day view hides the completed row optimistically (instant, no
  // main-thread-blocking re-render), and other surfaces (grid / week /
  // month) call router.refresh() from the modal after this resolves.
  // Forcing a full-page revalidation here was the "multiple seconds /
  // dropped taps / scroll glitch" cause on mobile: every tap re-ran
  // HomePage's queries + reconciled the 271-section day list. Dynamic
  // routes always re-fetch on navigation, so nothing goes stale beyond
  // the current render. (Also no invalidateBackfillCache — completing
  // doesn't change future instance generation.)
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
  // updateActivityRhythm is now the "full reset" path. It updates
  // every future-facing field on the activity (name, notes, tags,
  // priority, dates, reminders, rhythm, scheduled_times) AND
  // regenerates the pending instance set. Past instances + their
  // completions stay intact per the immutable-history rule.

  // ---- 1. Parse scheduled times (used both for rhythm validation and
  //         for the activity update). The Daily + multi-times shortcut
  //         is collapsed into a frequency rhythm just like in create. -

  const scheduledTimes = formData
    .getAll("scheduledTime")
    .map(String)
    .filter((s) => /^\d{2}:\d{2}$/.test(s));

  // ---- 2. Reconstruct + validate the rhythm ------------------------------

  const rhythmType = String(formData.get("rhythmType") ?? "single");
  let candidateRhythm: unknown;
  switch (rhythmType) {
    case "single":
      candidateRhythm = { type: "single" };
      break;
    case "daily":
      if (scheduledTimes.length > 1) {
        candidateRhythm = {
          type: "frequency",
          count: scheduledTimes.length,
          perCount: 1,
          perUnit: "days",
        };
      } else {
        candidateRhythm = { type: "daily" };
      }
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

  // ---- 3. Other activity-level fields ------------------------------------

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Activity name is required." };
  if (name.length > 120) return { error: "Name is too long (max 120)." };

  const notesRaw = String(formData.get("notes") ?? "").trim();
  const notes = notesRaw.length === 0 ? null : notesRaw;

  const tags = Array.from(
    new Set(
      formData
        .getAll("tag")
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );

  const priority = clampInt(formData.get("priority"), 1, 3, 2);

  const reminders = parseRemindersFromForm(formData);
  const remindersValidated = remindersSchema.safeParse(reminders);
  if (!remindersValidated.success) {
    return { error: "One of the reminders is invalid." };
  }

  // ---- 4. Schedule range (start_date, end_date) --------------------------

  const todayStr = new Date().toISOString().slice(0, 10);
  const newStartDate = parseDateField(formData.get("startDate")) ?? todayStr;
  let newEndDate: string | null;
  if (newRhythm.type === "single") {
    newEndDate = newStartDate;
  } else {
    newEndDate = parseDateField(formData.get("endDate"));
    if (newEndDate && newEndDate < newStartDate) {
      return { error: "End date must be on or after the start date." };
    }
  }

  // ---- 5. Auth + persist all fields --------------------------------------

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error: uerr } = await supabase
    .from("activities")
    .update({
      name,
      notes,
      rhythm: newRhythm,
      start_date: newStartDate,
      end_date: newEndDate,
      priority,
      default_skill_tags: tags,
      scheduled_times: scheduledTimes,
      reminders: remindersValidated.data,
      track_on_grid: String(formData.get("trackOnGrid")) === "true",
    })
    .eq("id", activityId);
  if (uerr) return { error: uerr.message };

  // ---- 6. Wipe pending future instances ----------------------------------
  // Past instances (completed/missed/pending) stay — they're history.

  await supabase
    .from("activity_instances")
    .delete()
    .eq("activity_id", activityId)
    .eq("status", "pending")
    .gte("scheduled_for", todayStr);

  // ---- 7. Regenerate from max(today, new_start_date) up to horizon --------

  const startDate =
    newStartDate > todayStr ? newStartDate : todayStr;
  const horizonStr = addDays(
    parseISODate(startDate),
    INSTANCE_HORIZON_DAYS
  )
    .toISOString()
    .slice(0, 10);
  const generationTo =
    newEndDate !== null && newEndDate < horizonStr ? newEndDate : horizonStr;

  const instances = generateInstances(newRhythm, {
    from: startDate,
    to: generationTo,
  });
  if (instances.length > 0) {
    // Snapshot the activity's NEW tags into each regenerated instance.
    // Per the immutable-history rule, past instances + their tag
    // snapshots stay untouched — only these freshly-regenerated future
    // instances see the new tag set.
    const rows = instances.map((i) => ({
      activity_id: activityId,
      scheduled_for: i.scheduledFor,
      status: "pending" as const,
      tags,
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
  // Target matches logCompletion's logic: frequency → rhythm.count;
  // any rhythm with > 1 scheduled times → scheduled_times.length;
  // otherwise → 1. Keeps multi-time daily/weekdays/etc. consistent
  // with the per-row +1 UX.
  const { data: inst } = await supabase
    .from("activity_instances")
    .select("activities ( rhythm, scheduled_times )")
    .eq("id", instanceId)
    .single();
  const activity = (
    inst as {
      activities?: {
        rhythm?: { type?: string; count?: number };
        scheduled_times?: string[] | null;
      };
    } | null
  )?.activities;
  const rhythm = activity?.rhythm;
  const scheduledTimes = activity?.scheduled_times ?? [];
  const target =
    rhythm?.type === "frequency"
      ? rhythm.count ?? 1
      : scheduledTimes.length > 1
        ? scheduledTimes.length
        : 1;
  const newStatus = safeTarget >= target ? "completed" : "pending";

  await supabase
    .from("activity_instances")
    .update({ status: newStatus })
    .eq("id", instanceId);

  // PERF: no backfill invalidation — changing an instance's completion
  // count / status doesn't affect future instance generation. (Same
  // reasoning as completeInstance.)
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

  // Drop the future pending occurrences (today onward). Without this they'd
  // linger and turn "overdue/unlabeled" during the archived gap, which would
  // BREAK the streak — but dropping should PAUSE it. computeStreak walks the
  // actual instance rows, so removing the gap rows lets the streak resume
  // seamlessly when the activity is unarchived (the pre-archive completions
  // connect straight to the post-unarchive ones). Past occurrences (already
  // missed before the drop) stay — those correctly count against the streak.
  const todayStr = new Date().toISOString().slice(0, 10);
  await supabase
    .from("activity_instances")
    .delete()
    .eq("activity_id", activityId)
    .eq("status", "pending")
    .gte("scheduled_for", todayStr);

  // Archived activities are excluded from backfill — drop the cache so the
  // next page-load doesn't keep extending an activity the user just hid.
  invalidateBackfillCache(user.id);
  revalidatePath("/");
  revalidatePath("/activities");
}

// ---------------------------------------------------------------------------
// setTrackOnGrid — toggle whether an activity shows in the Grid view
// (migration 0016). Doesn't touch tracking itself, just grid display.
// ---------------------------------------------------------------------------

export async function setTrackOnGrid(activityId: string, value: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await supabase
    .from("activities")
    .update({ track_on_grid: value })
    .eq("id", activityId)
    .eq("user_id", user.id);

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
    priority: Number(formData.get("priority") ?? 2),
    startDate: formData.get("startDate"),
    endDate: endDateRaw.length > 0 ? endDateRaw : undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // Tags come from the TagPicker (one hidden `<input name="tag">` per
  // selected). Same change as createActivity — deduplicate just in case.
  const tags = Array.from(
    new Set(
      formData
        .getAll("tag")
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );

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

// ---------------------------------------------------------------------------
// updateInstanceFields — "Edit activity" for ONE occurrence.
//
// Writes per-occurrence OVERRIDE columns on the activity_instances row
// (name / notes / priority / tags) and NEVER touches the parent activity
// or any other occurrence. This is the fix for "editing an activity's
// notes changed every future occurrence": those fields used to live only
// on the shared activity row. The app reads
// `coalesce(instance.override, activity.value)` for display, so an
// occurrence with no override still shows the series value.
//
// Series-wide edits (rhythm, schedule dates, times, reminders) are a
// separate path — updateActivityRhythm, reached via "Edit rhythm".
// ---------------------------------------------------------------------------

const instanceEditSchema = z.object({
  name: z.string().trim().min(1, "Name can't be empty.").max(120),
  notes: z.string().trim().max(500),
  priority: z.number().int().min(1).max(3),
});

export async function updateInstanceFields(
  instanceId: string,
  _prev: UpdateActivityState,
  formData: FormData
): Promise<UpdateActivityState> {
  const parsed = instanceEditSchema.safeParse({
    name: formData.get("name"),
    notes: formData.get("notes") ?? "",
    priority: Number(formData.get("priority") ?? 2),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // Tags come from the TagPicker (one hidden `<input name="tag">` per
  // selected). Deduplicate to be safe.
  const tags = Array.from(
    new Set(
      formData
        .getAll("tag")
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Per-occurrence override write — ONLY this instance row. RLS scopes
  // it to the user via the activity-FK policy (same path completeInstance
  // / missInstance already update through).
  const { error } = await supabase
    .from("activity_instances")
    .update({
      name: parsed.data.name,
      notes: parsed.data.notes.length === 0 ? null : parsed.data.notes,
      priority: parsed.data.priority,
      tags,
    })
    .eq("id", instanceId);

  if (error) return { error: error.message };

  // No backfill invalidation — a per-occurrence edit doesn't change
  // future instance generation. Revalidate so the day list reflects the
  // override on the next render.
  revalidatePath("/");
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
// unarchiveActivityWithEdit — power the archive page's "Unarchive" flow.
//
// Per user spec: when the user clicks Unarchive, they see the activity in
// the same Edit-rhythm form, but with `start_date` blank so they have to
// pick a fresh one. Saving runs the full update-and-regenerate path AND
// clears `archived_at` in one shot.
//
// Implementation reuses `updateActivityRhythm` for the field updates +
// instance regeneration (so the two stay in lockstep — no risk of one
// path quietly diverging from the other), then runs a small follow-up
// update to clear archived_at. The double round-trip is fine: this is a
// rare user-driven action, not a hot path.
// ---------------------------------------------------------------------------

export async function unarchiveActivityWithEdit(
  activityId: string,
  prev: UpdateActivityRhythmState,
  formData: FormData
): Promise<UpdateActivityRhythmState> {
  const result = await updateActivityRhythm(activityId, prev, formData);
  if (!result || "error" in result) return result;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error: uerr } = await supabase
    .from("activities")
    .update({ archived_at: null })
    .eq("id", activityId);
  if (uerr) return { error: uerr.message };

  invalidateBackfillCache(user.id);
  revalidatePath("/");
  revalidatePath("/activities");
  return result;
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

  // PERF: persist only, no revalidatePath — same instant-tap reasoning
  // as completeInstance. Day view hides the row optimistically; the
  // modal (grid/week/month) calls router.refresh() afterward.
}

// Kept as an alias for any older imports while we transition. UI no
// longer calls this; safe to delete in a follow-up cleanup.
export async function skipInstance(instanceId: string) {
  return missInstance(instanceId);
}

// ---------------------------------------------------------------------------
// unlabelInstance — revert a completed/missed occurrence back to pending.
// For accidental taps: from the Completed/Missed dropdown the modal offers
// "Unlabel" in place of the verdict the row already carries.
//
// If it was completed, we also remove the linked completion(s) so the
// occurrence truly resets (X/Y count back to 0). Missed rows have no
// completions to clean up.
// ---------------------------------------------------------------------------

export async function unlabelInstance(instanceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: links } = await supabase
    .from("completion_instances")
    .select("completion_id")
    .eq("instance_id", instanceId);
  const completionIds = Array.from(
    new Set(((links ?? []) as Array<{ completion_id: string }>).map(
      (l) => l.completion_id
    ))
  );
  if (completionIds.length > 0) {
    // Deleting the completion cascades to its completion_instances rows.
    await supabase.from("completions").delete().in("id", completionIds);
  }

  await supabase
    .from("activity_instances")
    .update({ status: "pending" })
    .eq("id", instanceId);

  // Per-occurrence change, no future-generation impact → no backfill
  // invalidation. The modal calls router.refresh() so the day view moves
  // the row from the Completed/Missed dropdown back to the active list.
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
