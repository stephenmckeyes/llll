"use server";

// ---------------------------------------------------------------------------
// Coaches (migration 0072) — server actions for the Coaches tab.
//
// Phase 1: apply to be a coach, admin verification, and the public
// "Find a Coach" directory. Chat (reuse `messages`), activity sharing, the
// coach activity cache, and review writing arrive in later phases.
// ---------------------------------------------------------------------------

import { addDays } from "date-fns";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { generateInstances } from "@/lib/domain/rhythms";
import {
  parseActivityTemplateForm,
} from "@/lib/domain/activity-template-parse";
import {
  getSharedInstancesWithMe,
  getSharedWithMe,
  type SharedActivity,
  type SharedInstance,
} from "@/app/actions/sharing";
import type { Rhythm } from "@/lib/validators/rhythm";

export type CoachDirectoryEntry = {
  userId: string;
  displayName: string | null;
  username: string | null;
  bio: string | null;
  photoUrl: string | null;
  priceAmount: number | null;
  priceUnit: "day" | "week" | null;
  ratingAvg: number | null;
  ratingCount: number;
};

export type MyCoachProfile = {
  bio: string | null;
  photoUrl: string | null;
  priceAmount: number | null;
  priceUnit: "day" | "week" | null;
  status: "pending" | "verified" | "rejected";
};

export type PendingCoachApplication = {
  userId: string;
  displayName: string | null;
  username: string | null;
  bio: string | null;
  photoUrl: string | null;
  priceAmount: number | null;
  priceUnit: "day" | "week" | null;
  appliedAt: string;
};

function coercePriceUnit(v: unknown): "day" | "week" | null {
  return v === "day" || v === "week" ? v : null;
}

// Is the current user a platform admin (can verify coach applications)?
export async function isCurrentUserAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  return (data as { is_admin?: boolean } | null)?.is_admin === true;
}

// The caller's own coach application (any status), or null if they haven't
// applied. Read via the owner RLS policy.
export async function getMyCoachProfile(): Promise<MyCoachProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("coach_profiles")
    .select("bio, photo_url, price_amount, price_unit, status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) return null;
  const r = data as {
    bio: string | null;
    photo_url: string | null;
    price_amount: number | null;
    price_unit: string | null;
    status: string;
  };
  return {
    bio: r.bio,
    photoUrl: r.photo_url,
    priceAmount: r.price_amount,
    priceUnit: coercePriceUnit(r.price_unit),
    status:
      r.status === "verified" || r.status === "rejected"
        ? r.status
        : "pending",
  };
}

// The public "Find a Coach" directory — verified coaches only.
export async function getCoachDirectory(): Promise<CoachDirectoryEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_coach_directory");
  return ((data ?? []) as Array<{
    user_id: string;
    display_name: string | null;
    username: string | null;
    bio: string | null;
    photo_url: string | null;
    price_amount: number | null;
    price_unit: string | null;
    rating_avg: number | null;
    rating_count: number;
  }>).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    bio: r.bio,
    photoUrl: r.photo_url,
    priceAmount: r.price_amount,
    priceUnit: coercePriceUnit(r.price_unit),
    ratingAvg: r.rating_avg,
    ratingCount: r.rating_count ?? 0,
  }));
}

// Pending applications for the admin review queue (RPC enforces is_admin).
export async function getPendingCoachApplications(): Promise<
  PendingCoachApplication[]
> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_pending_coach_applications");
  return ((data ?? []) as Array<{
    user_id: string;
    display_name: string | null;
    username: string | null;
    bio: string | null;
    photo_url: string | null;
    price_amount: number | null;
    price_unit: string | null;
    applied_at: string;
  }>).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    username: r.username,
    bio: r.bio,
    photoUrl: r.photo_url,
    priceAmount: r.price_amount,
    priceUnit: coercePriceUnit(r.price_unit),
    appliedAt: r.applied_at,
  }));
}

// Create/update the caller's coach application (sets status pending on apply).
export async function applyAsCoach(input: {
  bio: string;
  photoUrl: string;
  priceAmount: number | null;
  priceUnit: "day" | "week" | null;
}): Promise<{ error: string } | { ok: true; status: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase.rpc("apply_as_coach", {
    p_bio: input.bio,
    p_photo_url: input.photoUrl,
    p_price_amount: input.priceAmount,
    p_price_unit: input.priceUnit,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true, status: String(data ?? "pending") };
}

// ---------------------------------------------------------------------------
// Coaching relationships + chat (migration 0073).
// ---------------------------------------------------------------------------

export type CoachingParty = {
  otherUserId: string;
  displayName: string | null;
  username: string | null;
  photoUrl: string | null;
  status: "active" | "ended";
  startedAt: string;
};

function partyName(p: { displayName: string | null; username: string | null }) {
  return p.displayName ?? (p.username ? `@${p.username}` : "Someone");
}

// Engage a verified coach (as the client). Reactivates an ended relationship.
export async function startCoaching(
  coachUserId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.rpc("start_coaching", {
    p_coach_user_id: coachUserId,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}

// End an active coaching relationship (either participant).
export async function endCoaching(
  otherUserId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.rpc("end_coaching", {
    p_other_user_id: otherUserId,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}

// The caller's coaches (where they're the client).
export async function getMyCoaches(): Promise<CoachingParty[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_coaches");
  return ((data ?? []) as Array<{
    other_user_id: string;
    display_name: string | null;
    username: string | null;
    photo_url: string | null;
    status: string;
    started_at: string;
  }>).map((r) => ({
    otherUserId: r.other_user_id,
    displayName: r.display_name,
    username: r.username,
    photoUrl: r.photo_url,
    status: r.status === "ended" ? "ended" : "active",
    startedAt: r.started_at,
  }));
}

// The caller's clients (where they're the coach).
export async function getMyClients(): Promise<CoachingParty[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_clients");
  return ((data ?? []) as Array<{
    other_user_id: string;
    display_name: string | null;
    username: string | null;
    status: string;
    started_at: string;
  }>).map((r) => ({
    otherUserId: r.other_user_id,
    displayName: r.display_name,
    username: r.username,
    photoUrl: null,
    status: r.status === "ended" ? "ended" : "active",
    startedAt: r.started_at,
  }));
}

// The other participant of a coaching chat (guards the coach-chat page). Returns
// null if no relationship exists in either direction.
export async function getCoachingCounterparty(otherUserId: string): Promise<
  | { name: string; status: "active" | "ended"; iAmCoach: boolean }
  | null
> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_coaching_counterparty", {
    p_other_user_id: otherUserId,
  });
  const row = ((data ?? []) as Array<{
    display_name: string | null;
    username: string | null;
    status: string;
    i_am_coach: boolean;
  }>)[0];
  if (!row) return null;
  return {
    name: partyName({ displayName: row.display_name, username: row.username }),
    status: row.status === "ended" ? "ended" : "active",
    iAmCoach: row.i_am_coach,
  };
}

// ---------------------------------------------------------------------------
// Coach activity cache: templates + offers (migration 0074).
// ---------------------------------------------------------------------------

const OFFER_HORIZON_DAYS = 400;

export type CoachTemplate = {
  id: string;
  name: string;
  notes: string | null;
  rhythm: Rhythm;
  scheduledTimes: string[];
  scheduledEndTimes: string[];
  defaultSkillTags: string[];
};

export type CoachOffer = {
  id: string;
  coachUserId: string;
  coachName: string;
  name: string;
  notes: string | null;
  rhythm: Rhythm;
  scheduledTimes: string[];
  startDate: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
};

export type CoachTemplateFormState =
  | { error: string }
  | { ok: true }
  | null;

// The caller's (coach's) non-archived templates.
export async function getMyCoachTemplates(): Promise<CoachTemplate[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("coach_activity_templates")
    .select(
      "id, name, notes, rhythm, scheduled_times, scheduled_end_times, default_skill_tags"
    )
    .eq("coach_user_id", user.id)
    .is("archived_at", null)
    .order("name");
  return ((data ?? []) as Array<{
    id: string;
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    scheduled_times: string[] | null;
    scheduled_end_times: string[] | null;
    default_skill_tags: string[] | null;
  }>).map((r) => ({
    id: r.id,
    name: r.name,
    notes: r.notes,
    rhythm: r.rhythm,
    scheduledTimes: r.scheduled_times ?? [],
    scheduledEndTimes: r.scheduled_end_times ?? [],
    defaultSkillTags: r.default_skill_tags ?? [],
  }));
}

export async function createCoachTemplateFormAction(
  _prev: CoachTemplateFormState,
  formData: FormData
): Promise<CoachTemplateFormState> {
  const parsed = parseActivityTemplateForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.from("coach_activity_templates").insert({
    coach_user_id: user.id,
    name: parsed.name,
    notes: parsed.notes,
    rhythm: parsed.rhythm,
    scheduled_times: parsed.scheduledTimes,
    scheduled_end_times: parsed.scheduledEndTimes,
    default_skill_tags: parsed.tags,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}

export async function updateCoachTemplateFormAction(
  templateId: string,
  _prev: CoachTemplateFormState,
  formData: FormData
): Promise<CoachTemplateFormState> {
  const parsed = parseActivityTemplateForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("coach_activity_templates")
    .update({
      name: parsed.name,
      notes: parsed.notes,
      rhythm: parsed.rhythm,
      scheduled_times: parsed.scheduledTimes,
      scheduled_end_times: parsed.scheduledEndTimes,
      default_skill_tags: parsed.tags,
      updated_at: new Date().toISOString(),
    })
    .eq("id", templateId)
    .eq("coach_user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}

export async function archiveCoachTemplate(
  templateId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase
    .from("coach_activity_templates")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", templateId)
    .eq("coach_user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}

// Duplicate a template (for a per-client tweak). Returns the new id.
export async function duplicateCoachTemplate(
  templateId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: t } = await supabase
    .from("coach_activity_templates")
    .select("name, notes, rhythm, scheduled_times, scheduled_end_times, default_skill_tags")
    .eq("id", templateId)
    .eq("coach_user_id", user.id)
    .maybeSingle();
  if (!t) return { error: "Template not found." };
  const row = t as {
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    scheduled_times: string[] | null;
    scheduled_end_times: string[] | null;
    default_skill_tags: string[] | null;
  };
  const { error } = await supabase.from("coach_activity_templates").insert({
    coach_user_id: user.id,
    name: `${row.name} (copy)`,
    notes: row.notes,
    rhythm: row.rhythm,
    scheduled_times: row.scheduled_times ?? [],
    scheduled_end_times: row.scheduled_end_times ?? [],
    default_skill_tags: row.default_skill_tags ?? [],
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}

// Coach sends a template to a client as an offer (RLS enforces the active
// coaching relationship). Snapshots the template fields + a start date.
export async function sendCoachOffer(input: {
  templateId: string;
  clientUserId: string;
  startDate: string;
}): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: t } = await supabase
    .from("coach_activity_templates")
    .select("name, notes, rhythm, scheduled_times, scheduled_end_times, default_skill_tags")
    .eq("id", input.templateId)
    .eq("coach_user_id", user.id)
    .maybeSingle();
  if (!t) return { error: "Template not found." };
  const row = t as {
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    scheduled_times: string[] | null;
    scheduled_end_times: string[] | null;
    default_skill_tags: string[] | null;
  };

  const { error } = await supabase.from("coach_activity_offers").insert({
    coach_user_id: user.id,
    client_user_id: input.clientUserId,
    name: row.name,
    notes: row.notes,
    rhythm: row.rhythm,
    scheduled_times: row.scheduled_times ?? [],
    scheduled_end_times: row.scheduled_end_times ?? [],
    default_skill_tags: row.default_skill_tags ?? [],
    start_date: input.startDate,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}

// The caller's incoming offers (as client).
export async function getMyCoachOffers(
  status: "pending" | "accepted" | "declined" | "all" = "pending"
): Promise<CoachOffer[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_coach_offers", { p_status: status });
  return ((data ?? []) as Array<{
    id: string;
    coach_user_id: string;
    coach_name: string | null;
    coach_username: string | null;
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    scheduled_times: string[] | null;
    start_date: string;
    status: string;
    created_at: string;
  }>).map((r) => ({
    id: r.id,
    coachUserId: r.coach_user_id,
    coachName:
      r.coach_name ?? (r.coach_username ? `@${r.coach_username}` : "Your coach"),
    name: r.name,
    notes: r.notes,
    rhythm: r.rhythm,
    scheduledTimes: r.scheduled_times ?? [],
    startDate: r.start_date,
    status:
      r.status === "accepted" || r.status === "declined" ? r.status : "pending",
    createdAt: r.created_at,
  }));
}

// Client accepts an offer → materialize a personal activity on their calendar
// and mark the offer accepted.
export async function acceptCoachOffer(
  offerId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Read the offer (client RLS allows own rows).
  const { data: o } = await supabase
    .from("coach_activity_offers")
    .select(
      "id, client_user_id, name, notes, rhythm, scheduled_times, scheduled_end_times, default_skill_tags, start_date, status"
    )
    .eq("id", offerId)
    .maybeSingle();
  if (!o) return { error: "Offer not found." };
  const offer = o as {
    client_user_id: string;
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    scheduled_times: string[] | null;
    scheduled_end_times: string[] | null;
    default_skill_tags: string[] | null;
    start_date: string;
    status: string;
  };
  if (offer.client_user_id !== user.id) return { error: "Not your offer." };
  if (offer.status !== "pending") return { error: "Offer already handled." };

  const tags = offer.default_skill_tags ?? [];
  const { data: activity, error: aerr } = await supabase
    .from("activities")
    .insert({
      user_id: user.id,
      name: offer.name,
      notes: offer.notes,
      rhythm: offer.rhythm,
      start_date: offer.start_date,
      default_skill_tags: tags,
      scheduled_times: offer.scheduled_times ?? [],
      scheduled_end_times: offer.scheduled_end_times ?? [],
    })
    .select("id")
    .single();
  if (aerr || !activity) {
    return { error: aerr?.message ?? "Could not add to your calendar." };
  }

  const horizon = addDays(new Date(`${offer.start_date}T00:00:00`), OFFER_HORIZON_DAYS)
    .toISOString()
    .slice(0, 10);
  const instances = generateInstances(offer.rhythm, {
    from: offer.start_date,
    to: horizon,
  });
  if (instances.length > 0) {
    await supabase.from("activity_instances").insert(
      instances.map((i) => ({
        activity_id: activity.id as string,
        scheduled_for: i.scheduledFor,
        status: "pending" as const,
        tags,
      }))
    );
  }

  await supabase
    .from("coach_activity_offers")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("id", offerId)
    .eq("client_user_id", user.id);

  revalidatePath("/friends/coaches");
  revalidatePath("/");
  return { ok: true };
}

export async function declineCoachOffer(
  offerId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase
    .from("coach_activity_offers")
    .update({ status: "declined", responded_at: new Date().toISOString() })
    .eq("id", offerId)
    .eq("client_user_id", user.id)
    .eq("status", "pending");
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Coach PLANS (migration 0081) — a named plan (title + description) containing
// multiple activities. Supersedes the single-activity template cache (0074).
// ---------------------------------------------------------------------------

export type CoachPlanActivity = {
  id: string;
  name: string;
  notes: string | null;
  rhythm: Rhythm;
  scheduledTimes: string[];
  scheduledEndTimes: string[];
  defaultSkillTags: string[];
  sortOrder: number;
};

export type CoachPlanSummary = {
  id: string;
  title: string;
  description: string | null;
  visibility: "private" | "public";
  activityCount: number;
};

export type CoachPlanDetail = {
  id: string;
  title: string;
  description: string | null;
  visibility: "private" | "public";
  activities: CoachPlanActivity[];
};

export type CoachPlanOffer = {
  id: string;
  coachName: string;
  planTitle: string;
  planDescription: string | null;
  startDate: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
  activities: Array<{ name: string; rhythm: Rhythm; scheduledTimes: string[] }>;
};

export type CoachPlanFormState = { error: string } | { ok: true } | null;

function mapPlanActivityRow(r: {
  id: string;
  name: string;
  notes: string | null;
  rhythm: Rhythm;
  scheduled_times: string[] | null;
  scheduled_end_times: string[] | null;
  default_skill_tags: string[] | null;
  sort_order: number;
}): CoachPlanActivity {
  return {
    id: r.id,
    name: r.name,
    notes: r.notes,
    rhythm: r.rhythm,
    scheduledTimes: r.scheduled_times ?? [],
    scheduledEndTimes: r.scheduled_end_times ?? [],
    defaultSkillTags: r.default_skill_tags ?? [],
    sortOrder: r.sort_order,
  };
}

// The caller's (coach's) non-archived plans with activity counts.
export async function getMyCoachPlans(): Promise<CoachPlanSummary[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data } = await supabase
    .from("coach_plans")
    .select("id, title, description, visibility, coach_plan_activities(count)")
    .eq("coach_user_id", user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  return ((data ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
    visibility: string;
    coach_plan_activities: Array<{ count: number }>;
  }>).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    visibility: r.visibility === "public" ? "public" : "private",
    activityCount: r.coach_plan_activities?.[0]?.count ?? 0,
  }));
}

// A single plan + its activities (owner), or null.
export async function getCoachPlan(planId: string): Promise<CoachPlanDetail | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: plan } = await supabase
    .from("coach_plans")
    .select("id, title, description, visibility")
    .eq("id", planId)
    .eq("coach_user_id", user.id)
    .maybeSingle();
  if (!plan) return null;
  const p = plan as {
    id: string;
    title: string;
    description: string | null;
    visibility: string;
  };
  const { data: acts } = await supabase
    .from("coach_plan_activities")
    .select(
      "id, name, notes, rhythm, scheduled_times, scheduled_end_times, default_skill_tags, sort_order"
    )
    .eq("plan_id", planId)
    .order("sort_order", { ascending: true });
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    visibility: p.visibility === "public" ? "public" : "private",
    activities: ((acts ?? []) as Parameters<typeof mapPlanActivityRow>[0][]).map(
      mapPlanActivityRow
    ),
  };
}

export async function createCoachPlan(
  title: string,
  description: string
): Promise<{ error: string } | { ok: true; id: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const t = title.trim();
  if (!t) return { error: "Give the plan a title." };
  if (t.length > 120) return { error: "Title is too long (max 120)." };
  const { data, error } = await supabase
    .from("coach_plans")
    .insert({
      coach_user_id: user.id,
      title: t,
      description: description.trim() || null,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create plan." };
  revalidatePath("/friends/coaches/apply");
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateCoachPlan(
  planId: string,
  input: { title: string; description: string; visibility: "private" | "public" }
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const t = input.title.trim();
  if (!t) return { error: "Give the plan a title." };
  const { error } = await supabase
    .from("coach_plans")
    .update({
      title: t,
      description: input.description.trim() || null,
      visibility: input.visibility,
      updated_at: new Date().toISOString(),
    })
    .eq("id", planId)
    .eq("coach_user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath(`/friends/coaches/plans/${planId}`);
  revalidatePath("/friends/coaches/apply");
  return { ok: true };
}

export async function archiveCoachPlan(
  planId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase
    .from("coach_plans")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", planId)
    .eq("coach_user_id", user.id);
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches/apply");
  return { ok: true };
}

// Add an activity to a plan (via the shared ActivityFormFields FormData).
export async function addPlanActivityFormAction(
  planId: string,
  _prev: CoachPlanFormState,
  formData: FormData
): Promise<CoachPlanFormState> {
  const parsed = parseActivityTemplateForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Confirm the plan is the caller's (RLS also enforces this on insert).
  const { data: plan } = await supabase
    .from("coach_plans")
    .select("id")
    .eq("id", planId)
    .eq("coach_user_id", user.id)
    .maybeSingle();
  if (!plan) return { error: "Plan not found." };
  // Append after the current last activity.
  const { data: last } = await supabase
    .from("coach_plan_activities")
    .select("sort_order")
    .eq("plan_id", planId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((last as { sort_order?: number } | null)?.sort_order ?? -1) + 1;
  const { error } = await supabase.from("coach_plan_activities").insert({
    plan_id: planId,
    name: parsed.name,
    notes: parsed.notes,
    rhythm: parsed.rhythm,
    scheduled_times: parsed.scheduledTimes,
    scheduled_end_times: parsed.scheduledEndTimes,
    default_skill_tags: parsed.tags,
    sort_order: nextOrder,
  });
  if (error) return { error: error.message };
  revalidatePath(`/friends/coaches/plans/${planId}`);
  return { ok: true };
}

export async function updatePlanActivityFormAction(
  activityId: string,
  _prev: CoachPlanFormState,
  formData: FormData
): Promise<CoachPlanFormState> {
  const parsed = parseActivityTemplateForm(formData);
  if ("error" in parsed) return { error: parsed.error };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase
    .from("coach_plan_activities")
    .update({
      name: parsed.name,
      notes: parsed.notes,
      rhythm: parsed.rhythm,
      scheduled_times: parsed.scheduledTimes,
      scheduled_end_times: parsed.scheduledEndTimes,
      default_skill_tags: parsed.tags,
    })
    .eq("id", activityId);
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches/plans");
  return { ok: true };
}

export async function removePlanActivity(
  activityId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  void user;
  const { error } = await supabase
    .from("coach_plan_activities")
    .delete()
    .eq("id", activityId);
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches/plans");
  return { ok: true };
}

// Send a whole plan to a client (snapshots the plan + all its activities).
export async function sendCoachPlanOffer(input: {
  planId: string;
  clientUserId: string;
  startDate: string;
}): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const plan = await getCoachPlan(input.planId);
  if (!plan) return { error: "Plan not found." };
  if (plan.activities.length === 0) {
    return { error: "Add at least one activity to the plan first." };
  }
  const { data: me } = await supabase
    .from("profiles")
    .select("display_name, username")
    .eq("id", user.id)
    .maybeSingle();
  const prof = (me ?? {}) as { display_name?: string | null; username?: string | null };
  const coachName =
    prof.display_name ?? (prof.username ? `@${prof.username}` : "Your coach");

  const { data: offer, error: oerr } = await supabase
    .from("coach_plan_offers")
    .insert({
      coach_user_id: user.id,
      client_user_id: input.clientUserId,
      coach_name: coachName,
      plan_title: plan.title,
      plan_description: plan.description,
      start_date: input.startDate,
    })
    .select("id")
    .single();
  if (oerr || !offer) return { error: oerr?.message ?? "Could not send plan." };

  const offerId = (offer as { id: string }).id;
  const { error: aerr } = await supabase.from("coach_plan_offer_activities").insert(
    plan.activities.map((a) => ({
      offer_id: offerId,
      name: a.name,
      notes: a.notes,
      rhythm: a.rhythm,
      scheduled_times: a.scheduledTimes,
      scheduled_end_times: a.scheduledEndTimes,
      default_skill_tags: a.defaultSkillTags,
      sort_order: a.sortOrder,
    }))
  );
  if (aerr) return { error: aerr.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}

// The caller's incoming plan offers (as client), with each plan's activities.
export async function getMyCoachPlanOffers(
  status: "pending" | "accepted" | "declined" | "all" = "pending"
): Promise<CoachPlanOffer[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  let q = supabase
    .from("coach_plan_offers")
    .select(
      "id, coach_name, plan_title, plan_description, start_date, status, created_at"
    )
    .eq("client_user_id", user.id)
    .order("created_at", { ascending: false });
  if (status !== "all") q = q.eq("status", status);
  const { data: offers } = await q;
  const rows = (offers ?? []) as Array<{
    id: string;
    coach_name: string | null;
    plan_title: string;
    plan_description: string | null;
    start_date: string;
    status: string;
    created_at: string;
  }>;
  if (rows.length === 0) return [];

  const { data: acts } = await supabase
    .from("coach_plan_offer_activities")
    .select("offer_id, name, rhythm, scheduled_times, sort_order")
    .in(
      "offer_id",
      rows.map((r) => r.id)
    )
    .order("sort_order", { ascending: true });
  const byOffer = new Map<
    string,
    Array<{ name: string; rhythm: Rhythm; scheduledTimes: string[] }>
  >();
  for (const a of (acts ?? []) as Array<{
    offer_id: string;
    name: string;
    rhythm: Rhythm;
    scheduled_times: string[] | null;
  }>) {
    const arr = byOffer.get(a.offer_id) ?? [];
    arr.push({ name: a.name, rhythm: a.rhythm, scheduledTimes: a.scheduled_times ?? [] });
    byOffer.set(a.offer_id, arr);
  }

  return rows.map((r) => ({
    id: r.id,
    coachName: r.coach_name ?? "Your coach",
    planTitle: r.plan_title,
    planDescription: r.plan_description,
    startDate: r.start_date,
    status:
      r.status === "accepted" || r.status === "declined" ? r.status : "pending",
    createdAt: r.created_at,
    activities: byOffer.get(r.id) ?? [],
  }));
}

// Client accepts a plan offer → materialize ALL its activities on their
// calendar, then mark it accepted.
export async function acceptCoachPlanOffer(
  offerId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: offer } = await supabase
    .from("coach_plan_offers")
    .select("id, client_user_id, start_date, status")
    .eq("id", offerId)
    .maybeSingle();
  if (!offer) return { error: "Offer not found." };
  const o = offer as {
    client_user_id: string;
    start_date: string;
    status: string;
  };
  if (o.client_user_id !== user.id) return { error: "Not your offer." };
  if (o.status !== "pending") return { error: "Offer already handled." };

  const { data: acts } = await supabase
    .from("coach_plan_offer_activities")
    .select("name, notes, rhythm, scheduled_times, scheduled_end_times, default_skill_tags")
    .eq("offer_id", offerId)
    .order("sort_order", { ascending: true });
  const activities = (acts ?? []) as Array<{
    name: string;
    notes: string | null;
    rhythm: Rhythm;
    scheduled_times: string[] | null;
    scheduled_end_times: string[] | null;
    default_skill_tags: string[] | null;
  }>;

  const horizon = addDays(
    new Date(`${o.start_date}T00:00:00`),
    OFFER_HORIZON_DAYS
  )
    .toISOString()
    .slice(0, 10);

  for (const a of activities) {
    const tags = a.default_skill_tags ?? [];
    const { data: activity, error: aerr } = await supabase
      .from("activities")
      .insert({
        user_id: user.id,
        name: a.name,
        notes: a.notes,
        rhythm: a.rhythm,
        start_date: o.start_date,
        default_skill_tags: tags,
        scheduled_times: a.scheduled_times ?? [],
        scheduled_end_times: a.scheduled_end_times ?? [],
      })
      .select("id")
      .single();
    if (aerr || !activity) {
      return { error: aerr?.message ?? "Could not add a plan activity." };
    }
    const instances = generateInstances(a.rhythm, {
      from: o.start_date,
      to: horizon,
    });
    if (instances.length > 0) {
      await supabase.from("activity_instances").insert(
        instances.map((i) => ({
          activity_id: (activity as { id: string }).id,
          scheduled_for: i.scheduledFor,
          status: "pending" as const,
          tags,
        }))
      );
    }
  }

  await supabase
    .from("coach_plan_offers")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("id", offerId)
    .eq("client_user_id", user.id);

  revalidatePath("/friends/coaches");
  revalidatePath("/");
  return { ok: true };
}

export async function declineCoachPlanOffer(
  offerId: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase
    .from("coach_plan_offers")
    .update({ status: "declined", responded_at: new Date().toISOString() })
    .eq("id", offerId)
    .eq("client_user_id", user.id)
    .eq("status", "pending");
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Reviews (migration 0075).
// ---------------------------------------------------------------------------

export type CoachReview = {
  reviewerName: string;
  rating: number;
  body: string | null;
  createdAt: string;
};

// Submit (or update) the caller's review of a coach they've worked with.
export async function submitCoachReview(
  coachUserId: string,
  rating: number,
  body: string
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.rpc("submit_coach_review", {
    p_coach_user_id: coachUserId,
    p_rating: rating,
    p_body: body,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}

// A coach's reviews (public).
export async function getCoachReviews(
  coachUserId: string
): Promise<CoachReview[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_coach_reviews", {
    p_coach_user_id: coachUserId,
  });
  return ((data ?? []) as Array<{
    reviewer_name: string | null;
    reviewer_username: string | null;
    rating: number;
    body: string | null;
    created_at: string;
  }>).map((r) => ({
    reviewerName:
      r.reviewer_name ?? (r.reviewer_username ? `@${r.reviewer_username}` : "A client"),
    rating: r.rating,
    body: r.body,
    createdAt: r.created_at,
  }));
}

// The caller's own review of a coach (prefill), or null.
export async function getMyCoachReview(
  coachUserId: string
): Promise<{ rating: number; body: string | null } | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_my_coach_review", {
    p_coach_user_id: coachUserId,
  });
  const row = ((data ?? []) as Array<{ rating: number; body: string | null }>)[0];
  return row ? { rating: row.rating, body: row.body } : null;
}

// ---------------------------------------------------------------------------
// Public coach PROFILE page reads (richer-profiles work). A verified coach has
// a public-ish profile at /friends/coaches/[coachId] showing photo/bio/price/
// rating, full reviews, and the plans they chose to make public.
// ---------------------------------------------------------------------------

// One verified coach's public directory entry (photo/bio/price/rating), or null
// if they aren't a verified/listed coach. Sourced from the same SECURITY
// DEFINER directory RPC so no extra RLS surface is needed.
export async function getCoachPublicProfile(
  coachUserId: string
): Promise<CoachDirectoryEntry | null> {
  const directory = await getCoachDirectory();
  return directory.find((c) => c.userId === coachUserId) ?? null;
}

// A coach's PUBLIC (free-to-preview) plans + their activities. Readable by
// anyone via the coach_plans / coach_plan_activities public-select policies
// (migration 0081). Private plans never appear here.
export async function getCoachPublicPlans(
  coachUserId: string
): Promise<CoachPlanDetail[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("coach_plans")
    .select(
      "id, title, description, visibility, coach_plan_activities(id, name, notes, rhythm, scheduled_times, scheduled_end_times, default_skill_tags, sort_order)"
    )
    .eq("coach_user_id", coachUserId)
    .eq("visibility", "public")
    .is("archived_at", null)
    .order("created_at", { ascending: false });
  return ((data ?? []) as Array<{
    id: string;
    title: string;
    description: string | null;
    visibility: string;
    coach_plan_activities: Parameters<typeof mapPlanActivityRow>[0][] | null;
  }>).map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    visibility: "public" as const,
    activities: (p.coach_plan_activities ?? [])
      .map(mapPlanActivityRow)
      .sort((a, b) => a.sortOrder - b.sortOrder),
  }));
}

// ---------------------------------------------------------------------------
// Share activities with a coach (migration 0076) — read side. The share action
// itself is the existing shareActivity (activity_shares); its INSERT policy now
// permits coaching pairs. This returns activities a specific user shared WITH
// the caller (for the coach to review a client's routines), in a window.
// ---------------------------------------------------------------------------

export async function getSharedByUser(
  ownerId: string,
  from: string,
  to: string
): Promise<{ activities: SharedActivity[]; instances: SharedInstance[] }> {
  const [allActs, allInst] = await Promise.all([
    getSharedWithMe(),
    getSharedInstancesWithMe(from, to),
  ]);
  return {
    activities: allActs.filter((a) => a.ownerId === ownerId),
    instances: allInst.filter((i) => i.ownerId === ownerId),
  };
}

// Admin: verify / reject / re-pend a coach application.
export async function setCoachStatus(
  userId: string,
  status: "pending" | "verified" | "rejected"
): Promise<{ error: string } | { ok: true }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("set_coach_status", {
    p_user_id: userId,
    p_status: status,
  });
  if (error) return { error: error.message };
  revalidatePath("/friends/coaches");
  return { ok: true };
}
