// ---------------------------------------------------------------------------
// Server actions used by the /today page.
//
// All mutations route through here so the page itself stays clean of
// imperative side effects.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logCompletion } from "@/lib/domain/completions";
import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// createDailyActivity — minimal "add a daily habit" path for v1.0.
// Creates the recurring_activity row AND today's instance in one call.
// (Full rhythm picker + 30-day instance generation lands in the next turn.)
// ---------------------------------------------------------------------------

export async function createDailyActivity(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    // Cheap surfacing — refined per-field validation comes with the full form.
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 1. Create the activity.
  const { data: activity, error: aerr } = await supabase
    .from("recurring_activities")
    .insert({
      user_id: user.id,
      name,
      recurrence: { type: "daily" },
    })
    .select("id")
    .single();
  if (aerr || !activity) return;

  // 2. Create today's instance (server-local date — TZ-aware version lands
  //    once the profile timezone setting is wired up).
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  await supabase
    .from("recurring_activity_instances")
    .insert({
      recurring_activity_id: activity.id,
      scheduled_for: today,
      status: "pending",
    });

  revalidatePath("/today");
}

// ---------------------------------------------------------------------------
// completeInstance — wraps logCompletion() with the per-instance flavor.
// ---------------------------------------------------------------------------

export async function completeInstance(instanceId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await logCompletion(supabase, user.id, {
    instanceIds: [instanceId],
  });

  revalidatePath("/today");
}
