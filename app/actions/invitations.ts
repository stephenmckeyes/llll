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
  mapInvitationRow,
  type Invitation,
  type InvitationCommunity,
} from "@/lib/domain/invitations";
import { generateInstances } from "@/lib/domain/rhythms";
import { remindersSchema, type Reminder } from "@/lib/validators/reminder";

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
  const notes = [`📍 ${i.location_name}`, i.notes].filter(Boolean).join("\n");

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
