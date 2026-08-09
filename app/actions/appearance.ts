// ---------------------------------------------------------------------------
// Server actions for /settings/appearance.
//
// Currently just the Add Activity form-density preference; other appearance
// options (theme, sleep mode) live entirely client-side in localStorage.
// ---------------------------------------------------------------------------

"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  isAddActivityDensity,
  type AddActivityDensity,
} from "@/lib/domain/add-activity-density";
import {
  isStreaksRange,
  type StreaksRange,
} from "@/lib/domain/streaks-range";
import { createClient } from "@/lib/supabase/server";
import { isTimeFormat, type TimeFormat } from "@/lib/ui/format-time";

// URL-safe random string long enough that brute-forcing is infeasible
// (32 bytes → 43 base64url chars = ~256 bits of entropy).
function newIcsToken(): string {
  return randomBytes(32).toString("base64url");
}

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

/**
 * Turn on calendar sync — mint an ics_token if the profile doesn't have
 * one, otherwise regenerate it. In both cases the returned string is
 * the FRESH token; callers should show the URL immediately.
 */
export async function enableIcsToken(): Promise<
  { error: string } | { ok: true; token: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const token = newIcsToken();
  const { error } = await supabase
    .from("profiles")
    .update({ ics_token: token })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/settings/appearance");
  return { ok: true, token };
}

/**
 * Clear the token so the calendar-export URL stops working for every
 * existing subscription. The user can re-enable to mint a new one.
 */
export async function disableIcsToken(): Promise<
  { error: string } | { ok: true }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ ics_token: null })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/settings/appearance");
  return { ok: true };
}

export async function updateDefaultStreaksRange(
  range: StreaksRange
): Promise<{ error: string } | { ok: true }> {
  if (!isStreaksRange(range)) return { error: "Invalid range." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ default_streaks_range: range })
    .eq("id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/settings/appearance");
  revalidatePath("/"); // Home reads it in parseGridRange fallback.
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
