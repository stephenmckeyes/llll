// ---------------------------------------------------------------------------
// Server actions for /settings/appearance.
//
// Currently just the Add Activity form-density preference; other appearance
// options (theme, sleep mode) live entirely client-side in localStorage.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  isAddActivityDensity,
  type AddActivityDensity,
} from "@/lib/domain/add-activity-density";
import { createClient } from "@/lib/supabase/server";
import { isTimeFormat, type TimeFormat } from "@/lib/ui/format-time";

export async function updateAddActivityDensity(
  density: AddActivityDensity
): Promise<{ error: string } | { ok: true }> {
  if (!isAddActivityDensity(density)) return { error: "Invalid density." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ add_activity_density: density })
    .eq("id", user.id);
  if (error) return { error: error.message };

  // Both the settings page + the Add Activity page depend on this
  // value; revalidate the routes that read it so the next render
  // reflects the new preference immediately.
  revalidatePath("/settings/appearance");
  revalidatePath("/activities/new");
  return { ok: true };
}

export async function updateTimeFormat(
  format: TimeFormat
): Promise<{ error: string } | { ok: true }> {
  if (!isTimeFormat(format)) return { error: "Invalid time format." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ time_format: format })
    .eq("id", user.id);
  if (error) return { error: error.message };

  // Every route that shows a scheduled time reads this eventually; the
  // client hook (`useTimeFormat`) mirrors it to localStorage so mounted
  // consumers pick up the change without a page reload. Revalidate the
  // settings page for the next SSR render.
  revalidatePath("/settings/appearance");
  return { ok: true };
}
