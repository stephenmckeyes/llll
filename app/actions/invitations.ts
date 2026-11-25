"use server";

// ---------------------------------------------------------------------------
// Invitations server actions (migration 0084). An invitation is an activity a
// person or community posts to invite others (friends / a community / nearby
// people / anyone). Visibility is enforced in the DB (RLS + SECURITY DEFINER
// RPCs); these actions only shape data. Joining copies the invitation into the
// viewer's own calendar as a personal activity (with their reminders).
//
// NOTE: "use server" — only async functions may be exported. Pure helpers live
// in lib/domain/invitations.ts.
// ---------------------------------------------------------------------------

import { addDays } from "date-fns";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { archiveActivity } from "@/app/actions/activities";
import { createClient } from "@/lib/supabase/server";
import { parseActivityTemplateForm } from "@/lib/domain/activity-template-parse";
import {
  isAudience,
  isSkillLevel,
  invitationCopyNotes,
  mapInvitationRow,
  type Invitation,
  type InvitationChangeNotice,
  type InvitationCommunity,
} from "@/lib/domain/invitations";
import { invalidateBackfillCache } from "@/lib/domain/backfill";
import { generateInstances } from "@/lib/domain/rhythms";
import { remindersSchema, type Reminder } from "@/lib/validators/reminder";
import type { Rhythm } from "@/lib/validators/rhythm";

const HORIZON_DAYS = 400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Result = { error: string } | { ok: true };

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

// --- reads -------------------------------------------------------------------

export async function getAvailableInvitations(
  coords?: { lat: number; lng: number } | null
): Promise<Invitation[]> {
  const { supabase } = await authed();
  const lat = coords && Number.isFinite(coords.lat) ? coords.lat : null;
  const lng = coords && Number.isFinite(coords.lng) ? coords.lng : null;
  const { data, error } = await supabase.rpc("get_available_invitations", {
    p_lat: lat,
    p_lng: lng,
  });
  if (error) {
    console.error("get_available_invitations failed", error.message);
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapInvitationRow);
}

export async function getMyInvitationCommunities(): Promise<InvitationCommunity[]> {
  const { supabase } = await authed();
  const { data, error } = await supabase.rpc("get_my_invitation_communities");
  if (error) return [];
  return ((data ?? []) as Array<{
    id: string;
    name: string;
    kind: string;
    can_host: boolean;
  }>).map((c) => ({ id: c.id, name: c.name, kind: c.kind, canHost: c.can_host }));
}

export async function getInvitationAttendees(
  invitationId: string
): Promise<Array<{ userId: string; name: string }>> {
  const { supabase } = await authed();
  const { data } = await supabase.rpc("get_invitation_attendees", {
    p_invitation_id: invitationId,
  });
  return ((data ?? []) as Array<{
    user_id: string;
    display_name: string | null;
    username: string | null;
  }>).map((r) => ({
    userId: r.user_id,
    name: r.display_name ?? (r.username ? `@${r.username}` : "Someone"),
  }));
}

// --- create / edit -----------------------------------------------------------

function parseInvitationForm(
  formData: FormData
): { error: string } | { row: Record<string, unknown> } {
  const base = parseActivityTemplateForm(formData);
  if ("error" in base) return base;
  if (base.scheduledTimes.length === 0) {
    return { error: "Invitations need a time — add at least one time of day." };
  }

  const startDate = String(formData.get("startDate") ?? "").trim();
  if (!DATE_RE.test(startDate)) return { error: "Pick a start date." };
  const endRaw = String(formData.get("endDate") ?? "").trim();
  let endDate: string | null = DATE_RE.test(endRaw) ? endRaw : null;
  if (endDate && endDate < startDate) {
    return { error: "End date can't be before the start date." };
  }
  if (base.rhythm.type === "single" && !endDate) endDate = startDate;

  const locationName = String(formData.get("locationName") ?? "").trim();
  if (!locationName) return { error: "Add a location." };
  if (locationName.length > 200) return { error: "Location is too long (max 200)." };

  const latRaw = String(formData.get("latitude") ?? "").trim();
  const lngRaw = String(formData.get("longitude") ?? "").trim();
  const lat = latRaw ? Number(latRaw) : null;
  const lng = lngRaw ? Number(lngRaw) : null;
  const hasCoords =
    lat !== null &&
    lng !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;

  const audienceRaw = String(formData.get("audience") ?? "friends");
  if (!isAudience(audienceRaw)) return { error: "Pick who to invite." };
  const audience = audienceRaw;

  const hostCommunityId =
    String(formData.get("hostCommunityId") ?? "").trim() || null;
  let audienceCommunityId =
    String(formData.get("audienceCommunityId") ?? "").trim() || null;
  if (audience === "community") {
    if (hostCommunityId) audienceCommunityId = hostCommunityId;
    if (!audienceCommunityId) return { error: "Pick which community to invite." };
  } else {
    audienceCommunityId = null;
  }
  if (hostCommunityId && audience === "friends") {
    return { error: "A community invitation can't target friends — pick Community, Nearby, or Anyone." };
  }

  let radiusKm: number | null = null;
  if (audience === "nearby") {
    if (!hasCoords) {
      return { error: "Nearby invitations need coordinates — tap “Use my current location”." };
    }
    const r = Number(String(formData.get("radiusKm") ?? ""));
    if (!Number.isFinite(r) || r <= 0 || r > 1000) {
      return { error: "Pick a radius between 1 and 1000 km." };
    }
    radiusKm = r;
  }

  const skillRaw = String(formData.get("skillLevel") ?? "all");
  const skillLevel = isSkillLevel(skillRaw) ? skillRaw : "all";

  const capRaw = String(formData.get("capacity") ?? "").trim();
  let capacity: number | null = null;
  if (capRaw) {
    const c = parseInt(capRaw, 10);
    if (!Number.isFinite(c) || c < 1 || c > 10000) {
      return { error: "Spots must be between 1 and 10000 (or blank for no limit)." };
    }
    capacity = c;
  }

  return {
    row: {
      name: base.name,
      notes: base.notes,
      rhythm: base.rhythm,
      start_date: startDate,
      end_date: endDate,
      scheduled_times: base.scheduledTimes,
      scheduled_end_times: base.scheduledEndTimes,
      default_skill_tags: base.tags,
      location_name: locationName,
      latitude: hasCoords ? lat : null,
      longitude: hasCoords ? lng : null,
      audience,
      audience_community_id: audienceCommunityId,
      radius_km: radiusKm,
      skill_level: skillLevel,
      capacity,
      host_community_id: hostCommunityId,
    },
  };
}

export async function createInvitationFormAction(
  _prev: Result | null,
  formData: FormData
): Promise<Result> {
  const { supabase, user } = await authed();
  const parsed = parseInvitationForm(formData);
  if ("error" in parsed) return parsed;
  const { error } = await supabase
    .from("invitations")
    .insert({ ...parsed.row, host_user_id: user.id });
  if (error) {
    return {
      error: error.message.includes("row-level security")
        ? "You don't have permission to post that invitation."
        : error.message,
    };
  }
  revalidatePath("/friends/invitations");
  return { ok: true };
}

export async function updateInvitationFormAction(
  invitationId: string,
  _prev: Result | null,
  formData: FormData
): Promise<Result> {
  const { supabase } = await authed();
  const parsed = parseInvitationForm(formData);
  if ("error" in parsed) return parsed;
  // The host (person/community) is fixed after creation.
  const { host_community_id: _ignored, ...row } = parsed.row;
  void _ignored;
  const { error, count } = await supabase
    .from("invitations")
    .update({ ...row, updated_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", invitationId);
  if (error) return { error: error.message };
  if (count === 0) return { error: "You can't edit this invitation." };
  revalidatePath("/friends/invitations");
  return { ok: true };
}

export async function cancelInvitation(invitationId: string): Promise<Result> {
  const { supabase } = await authed();
  const { error, count } = await supabase
    .from("invitations")
    .update({ archived_at: new Date().toISOString() }, { count: "exact" })
    .eq("id", invitationId);
  if (error) return { error: error.message };
  if (count === 0) return { error: "You can't cancel this invitation." };
  revalidatePath("/friends/invitations");
  return { ok: true };
}

// --- join / leave ------------------------------------------------------------

function parseReminders(formData: FormData): Reminder[] {
  const days = formData.getAll("reminderDays");
  const hours = formData.getAll("reminderHours");
  const mins = formData.getAll("reminderMinutes");
  const n = Math.min(days.length, hours.length, mins.length);
  const clamp = (v: FormDataEntryValue, max: number) => {
    const x = parseInt(String(v), 10);
    return Number.isFinite(x) ? Math.min(Math.max(x, 0), max) : 0;
  };
  const out: Reminder[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      days: clamp(days[i], 30),
      hours: clamp(hours[i], 23),
      minutes: clamp(mins[i], 59),
    });
  }
  return out;
}

/** Copy an invitation onto the caller's calendar (with their reminders) and
 *  RSVP. Recurring invitations that already started begin from today. */
export async function addInvitationToCalendarFormAction(
  invitationId: string,
  _prev: Result | null,
  formData: FormData
): Promise<Result> {
  const { supabase, user } = await authed();

  const remindersParsed = remindersSchema.safeParse(parseReminders(formData));
  if (!remindersParsed.success) return { error: "Invalid reminders." };

  const { data: inv } = await supabase
    .from("invitations")
    .select(
      "id, name, notes, rhythm, start_date, end_date, scheduled_times, scheduled_end_times, default_skill_tags, location_name, archived_at"
    )
    .eq("id", invitationId)
    .maybeSingle();
  if (!inv) return { error: "Invitation not found." };
  const i = inv as {
    name: string;
    notes: string | null;
    rhythm: { type: string };
    start_date: string;
    end_date: string | null;
    scheduled_times: string[];
    scheduled_end_times: string[];
    default_skill_tags: string[];
    location_name: string;
    archived_at: string | null;
  };
  if (i.archived_at) return { error: "This invitation was cancelled." };

  // Already going with a live calendar copy → nothing to do.
  const { data: existing } = await supabase
    .from("invitation_attendees")
    .select("activity_id")
    .eq("invitation_id", invitationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if ((existing as { activity_id: string | null } | null)?.activity_id) {
    return { ok: true };
  }

  const today = new Date().toISOString().slice(0, 10);
  const isSingle = i.rhythm.type === "single";
  const startDate = !isSingle && i.start_date < today ? today : i.start_date;
  const endDate = i.end_date;
  if (endDate && endDate < startDate) {
    return { error: "This invitation has already ended." };
  }

  const tags = i.default_skill_tags ?? [];
  const notes = invitationCopyNotes(i.location_name, i.notes);

  const { data: activity, error: aerr } = await supabase
    .from("activities")
    .insert({
      user_id: user.id,
      name: i.name,
      notes,
      rhythm: i.rhythm,
      start_date: startDate,
      end_date: endDate,
      default_skill_tags: tags,
      scheduled_times: i.scheduled_times ?? [],
      scheduled_end_times: i.scheduled_end_times ?? [],
      reminders: remindersParsed.data,
      auto_archive: isSingle,
    })
    .select("id")
    .single();
  if (aerr || !activity) {
    return { error: aerr?.message ?? "Could not add it to your calendar." };
  }
  const activityId = (activity as { id: string }).id;

  const horizon = addDays(new Date(`${startDate}T00:00:00Z`), HORIZON_DAYS)
    .toISOString()
    .slice(0, 10);
  const isSpan = isSingle && endDate !== null && endDate > startDate;
  const instances = isSpan
    ? generateInstances({ type: "daily" }, { from: startDate, to: endDate as string })
    : generateInstances(i.rhythm as Parameters<typeof generateInstances>[0], {
        from: startDate,
        to: endDate && endDate < horizon ? endDate : horizon,
      });
  if (instances.length > 0) {
    await supabase.from("activity_instances").insert(
      instances.map((x) => ({
        activity_id: activityId,
        scheduled_for: x.scheduledFor,
        status: "pending" as const,
        tags,
      }))
    );
  }

  const { error: jerr } = await supabase.rpc("join_invitation", {
    p_invitation_id: invitationId,
    p_activity_id: activityId,
  });
  if (jerr) {
    // Roll back the calendar copy so a full / hidden invitation leaves no trace.
    await supabase.from("activities").delete().eq("id", activityId).eq("user_id", user.id);
    return { error: jerr.message.includes("full") ? "This invitation is full." : jerr.message };
  }

  revalidatePath("/friends/invitations");
  revalidatePath("/");
  return { ok: true };
}

/** Un-RSVP. Archives (not deletes) the calendar copy, so any history stays. */
export async function leaveInvitation(invitationId: string): Promise<Result> {
  const { supabase, user } = await authed();
  const { data: row } = await supabase
    .from("invitation_attendees")
    .select("activity_id")
    .eq("invitation_id", invitationId)
    .eq("user_id", user.id)
    .maybeSingle();
  const activityId = (row as { activity_id: string | null } | null)?.activity_id;
  const { error } = await supabase
    .from("invitation_attendees")
    .delete()
    .eq("invitation_id", invitationId)
    .eq("user_id", user.id);
  if (error) return { error: error.message };
  // Same path as the Archive button: archives + drops future pending
  // occurrences (past history stays) + clears the backfill cache.
  if (activityId) await archiveActivity(activityId);
  revalidatePath("/friends/invitations");
  revalidatePath("/");
  return { ok: true };
}

// --- change notices (migration 0086) ------------------------------------------
// When a host edits / cancels an invitation, a DB trigger writes a pending
// notice for each attendee. These actions list them and let the attendee apply
// the changes to their calendar copy, remove a cancelled one, or keep theirs.

export async function getMyInvitationChangeNotices(): Promise<InvitationChangeNotice[]> {
  const { supabase, user } = await authed();
  const { data: notices, error } = await supabase
    .from("invitation_change_notices")
    .select("id, invitation_id, kind, changes, updated_at")
    .is("resolved_at", null)
    .order("updated_at", { ascending: false });
  // Degrades to empty if 0086 isn't applied.
  if (error || !notices || notices.length === 0) return [];
  const rows = notices as Array<{
    id: string;
    invitation_id: string;
    kind: "updated" | "cancelled";
    changes: InvitationChangeNotice["changes"];
    updated_at: string;
  }>;
  const invIds = Array.from(new Set(rows.map((r) => r.invitation_id)));

  const [{ data: invs }, { data: atts }] = await Promise.all([
    supabase
      .from("invitations")
      .select("id, name")
      .in("id", invIds),
    supabase
      .from("invitation_attendees")
      .select("invitation_id, activity_id")
      .eq("user_id", user.id)
      .in("invitation_id", invIds),
  ]);
  const invById = new Map(
    ((invs ?? []) as Array<{ id: string; name: string }>).map((i) => [i.id, i])
  );
  const actByInv = new Map(
    ((atts ?? []) as Array<{ invitation_id: string; activity_id: string | null }>).map(
      (a) => [a.invitation_id, a.activity_id]
    )
  );

  // Host labels (community name, else the person) — via a SECURITY DEFINER
  // read (0087), since the attendee may not be allowed to read the host profile.
  const { data: labels } = await supabase.rpc("get_invitation_host_labels", {
    p_ids: invIds,
  });
  const hostLabelById = new Map(
    ((labels ?? []) as Array<{ invitation_id: string; host_label: string }>).map(
      (l) => [l.invitation_id, l.host_label]
    )
  );

  // Each live copy's next upcoming occurrence → "Open on my calendar" target.
  const activityIds = [...actByInv.values()].filter(Boolean) as string[];
  const today = new Date().toISOString().slice(0, 10);
  const nextByActivity = new Map<string, string>();
  const liveActivities = new Set<string>();
  if (activityIds.length) {
    const [{ data: acts }, { data: next }] = await Promise.all([
      supabase.from("activities").select("id").in("id", activityIds).is("archived_at", null),
      supabase
        .from("activity_instances")
        .select("activity_id, scheduled_for")
        .in("activity_id", activityIds)
        .gte("scheduled_for", today)
        .order("scheduled_for", { ascending: true }),
    ]);
    for (const a of (acts ?? []) as Array<{ id: string }>) liveActivities.add(a.id);
    for (const n of (next ?? []) as Array<{ activity_id: string; scheduled_for: string }>) {
      if (!nextByActivity.has(n.activity_id)) nextByActivity.set(n.activity_id, n.scheduled_for);
    }
  }

  return rows.map((r) => {
    const inv = invById.get(r.invitation_id);
    const activityId = actByInv.get(r.invitation_id) ?? null;
    const live = activityId !== null && liveActivities.has(activityId);
    return {
      id: r.id,
      invitationId: r.invitation_id,
      kind: r.kind,
      changes: r.changes ?? {},
      updatedAt: r.updated_at,
      invitationName: inv?.name ?? "An invitation",
      hostLabel: hostLabelById.get(r.invitation_id) ?? "The host",
      activityId: live ? activityId : null,
      nextDate: live && activityId ? nextByActivity.get(activityId) ?? null : null,
    };
  });
}

async function loadPendingNotice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  noticeId: string
) {
  const { data } = await supabase
    .from("invitation_change_notices")
    .select("id, invitation_id, kind, changes, resolved_at")
    .eq("id", noticeId)
    .maybeSingle();
  const n = data as {
    id: string;
    invitation_id: string;
    kind: "updated" | "cancelled";
    changes: Record<string, unknown>;
    resolved_at: string | null;
  } | null;
  if (!n || n.resolved_at) return null;
  return n;
}

async function resolveNotice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  noticeId: string,
  resolution: "applied" | "removed" | "kept"
) {
  await supabase
    .from("invitation_change_notices")
    .update({ resolved_at: new Date().toISOString(), resolution })
    .eq("id", noticeId);
}

/** Copy the invitation's CHANGED fields onto the attendee's calendar copy.
 *  Untouched fields (and their reminders) stay as the attendee set them. If
 *  the schedule changed, future pending occurrences are regenerated; past
 *  history is never touched. */
export async function applyInvitationChange(noticeId: string): Promise<Result> {
  const { supabase, user } = await authed();
  const notice = await loadPendingNotice(supabase, noticeId);
  if (!notice) return { error: "This update was already handled." };
  if (notice.kind !== "updated") return { error: "Nothing to apply." };

  const [{ data: invData }, { data: att }] = await Promise.all([
    supabase
      .from("invitations")
      .select(
        "name, notes, rhythm, start_date, end_date, scheduled_times, scheduled_end_times, default_skill_tags, location_name"
      )
      .eq("id", notice.invitation_id)
      .maybeSingle(),
    supabase
      .from("invitation_attendees")
      .select("activity_id")
      .eq("invitation_id", notice.invitation_id)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  const inv = invData as {
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    start_date: string;
    end_date: string | null;
    scheduled_times: string[];
    scheduled_end_times: string[];
    default_skill_tags: string[];
    location_name: string;
  } | null;
  const activityId = (att as { activity_id: string | null } | null)?.activity_id ?? null;
  if (!inv) return { error: "Invitation not found." };
  if (!activityId) return { error: "It's no longer on your calendar." };

  const { data: actData } = await supabase
    .from("activities")
    .select("id, start_date, default_skill_tags, archived_at")
    .eq("id", activityId)
    .eq("user_id", user.id)
    .maybeSingle();
  const act = actData as {
    id: string;
    start_date: string;
    default_skill_tags: string[];
    archived_at: string | null;
  } | null;
  if (!act || act.archived_at) return { error: "It's no longer on your calendar." };

  const changed = new Set(Object.keys(notice.changes ?? {}));
  const patch: Record<string, unknown> = {};
  if (changed.has("name")) patch.name = inv.name;
  if (changed.has("notes") || changed.has("location")) {
    patch.notes = invitationCopyNotes(inv.location_name, inv.notes);
  }
  if (changed.has("tags")) patch.default_skill_tags = inv.default_skill_tags ?? [];
  if (changed.has("times")) {
    patch.scheduled_times = inv.scheduled_times ?? [];
    patch.scheduled_end_times = inv.scheduled_end_times ?? [];
  }
  const today = new Date().toISOString().slice(0, 10);
  const scheduleChanged =
    changed.has("rhythm") || changed.has("start_date") || changed.has("end_date");
  let startDate = act.start_date;
  if (scheduleChanged) {
    const isSingle = inv.rhythm.type === "single";
    startDate = !isSingle && inv.start_date < today ? today : inv.start_date;
    patch.rhythm = inv.rhythm;
    patch.start_date = startDate;
    patch.end_date = inv.end_date;
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("activities").update(patch).eq("id", activityId);
    if (error) return { error: error.message };
  }

  if (scheduleChanged || changed.has("tags")) {
    const tags = (patch.default_skill_tags as string[] | undefined) ?? act.default_skill_tags ?? [];
    await supabase
      .from("activity_instances")
      .delete()
      .eq("activity_id", activityId)
      .eq("status", "pending")
      .gte("scheduled_for", today);

    const from = startDate > today ? startDate : today;
    const horizon = addDays(new Date(`${from}T00:00:00Z`), HORIZON_DAYS)
      .toISOString()
      .slice(0, 10);
    const end = inv.end_date;
    const isSpan = inv.rhythm.type === "single" && end !== null && end > inv.start_date;
    const generated =
      end !== null && end < from
        ? []
        : isSpan
          ? generateInstances({ type: "daily" }, { from, to: end as string })
          : inv.rhythm.type === "single"
            ? inv.start_date >= today
              ? [{ scheduledFor: inv.start_date }]
              : []
            : generateInstances(inv.rhythm, { from, to: end && end < horizon ? end : horizon });

    // Don't duplicate a day that already has a (completed/missed) occurrence.
    const { data: kept } = await supabase
      .from("activity_instances")
      .select("scheduled_for")
      .eq("activity_id", activityId)
      .gte("scheduled_for", today);
    const taken = new Set(((kept ?? []) as Array<{ scheduled_for: string }>).map((k) => k.scheduled_for));
    const rows = generated
      .filter((g) => !taken.has(g.scheduledFor))
      .map((g) => ({
        activity_id: activityId,
        scheduled_for: g.scheduledFor,
        status: "pending" as const,
        tags,
      }));
    if (rows.length > 0) await supabase.from("activity_instances").insert(rows);
    invalidateBackfillCache(user.id);
  }

  await resolveNotice(supabase, noticeId, "applied");
  revalidatePath("/notifications");
  revalidatePath("/");
  return { ok: true };
}

/** Keep the calendar copy as-is (ignore the host's change / cancellation). */
export async function keepInvitationCopy(noticeId: string): Promise<Result> {
  const { supabase } = await authed();
  const notice = await loadPendingNotice(supabase, noticeId);
  if (!notice) return { error: "This update was already handled." };
  await resolveNotice(supabase, noticeId, "kept");
  revalidatePath("/notifications");
  return { ok: true };
}

/** Remove a cancelled invitation from the calendar (archives the copy). */
export async function removeCancelledInvitation(noticeId: string): Promise<Result> {
  const { supabase } = await authed();
  const notice = await loadPendingNotice(supabase, noticeId);
  if (!notice) return { error: "This update was already handled." };
  const res = await leaveInvitation(notice.invitation_id);
  if ("error" in res) return res;
  await resolveNotice(supabase, noticeId, "removed");
  revalidatePath("/notifications");
  return { ok: true };
}
