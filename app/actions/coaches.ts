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
