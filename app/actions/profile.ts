// ---------------------------------------------------------------------------
// Profile + auth server actions powering /settings/account, /settings/
// timezone, and the password / email change flows.
//
//   updateProfile         — write display_name + timezone to the profile row.
//   updateAuthEmail       — start the email-change flow. Supabase sends a
//                           confirmation email to the new address; the change
//                           only takes effect once the user clicks the link.
//   updateAuthPassword    — change the password immediately. Supabase's
//                           updateUser({ password }) bypasses any current-
//                           password check (that's a TODO once we want
//                           defensive reauthorization).
//
// All three actions return a tagged state object so the calling client
// component can show inline success / error messages without re-routing.
// ---------------------------------------------------------------------------

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

// Permissive: matches IANA TZ names ("America/New_York", "Etc/UTC",
// etc) without locking us to a hard-coded allowlist. If the user
// types garbage, date math falls back to UTC behavior — same lenient
// validation the onboarding action uses.
const TZ_NAME_RE = /^[A-Za-z][A-Za-z0-9_+\-/]{0,99}$/;

export type UpdateProfileState =
  | { error: string }
  | { ok: true; message: string }
  | null;

export async function updateProfile(
  _prev: UpdateProfileState,
  formData: FormData
): Promise<UpdateProfileState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fields are optional per-call — only update what was submitted.
  // We use formData.has(name) (rather than reading the empty string)
  // so the action handles "this page only updates one of them"
  // cleanly: omitted = no change, explicitly cleared = save as empty.
  const update: Record<string, string | null> = {};

  if (formData.has("timezone")) {
    const tz = String(formData.get("timezone") ?? "").trim();
    if (!tz || !TZ_NAME_RE.test(tz)) {
      return { error: "Please pick a valid timezone." };
    }
    update.timezone = tz;
  }

  if (formData.has("displayName")) {
    const raw = String(formData.get("displayName") ?? "").trim();
    if (raw.length > 80) {
      return { error: "Display name is too long (max 80)." };
    }
    // Empty string → null so we don't pollute the column with "".
    update.display_name = raw.length === 0 ? null : raw;
  }

  if (Object.keys(update).length === 0) {
    return { error: "Nothing to update." };
  }

  const { error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", user.id);
  if (error) return { error: error.message };

  // The TimeChip in the header reads from the profile. Revalidate so
  // it picks up the new TZ on the next render.
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/settings/account");
  revalidatePath("/settings/timezone");
  return { ok: true, message: "Saved." };
}

// ---------------------------------------------------------------------------

export type UpdateAuthEmailState =
  | { error: string }
  | { ok: true; message: string }
  | null;

export async function updateAuthEmail(
  _prev: UpdateAuthEmailState,
  formData: FormData
): Promise<UpdateAuthEmailState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const email = String(formData.get("email") ?? "").trim();
  if (!email || !email.includes("@")) {
    return { error: "Enter a valid email address." };
  }
  if (email === user.email) {
    return { error: "That's your current email." };
  }

  // Supabase sends a confirmation link to the NEW address. The change
  // only takes effect after the user clicks that link. We don't
  // pre-update the profile or anything — Supabase tracks the pending
  // change on its side. (Future: also a confirm-from-old-address
  // step for security; toggleable via the email_change_confirm_old
  // project setting in Supabase.)
  const { error } = await supabase.auth.updateUser({ email });
  if (error) return { error: error.message };

  return {
    ok: true,
    message:
      "Check your inbox at the new address — we sent a confirmation link.",
  };
}

// ---------------------------------------------------------------------------

export type UpdateAuthPasswordState =
  | { error: string }
  | { ok: true; message: string }
  | null;

export async function updateAuthPassword(
  _prev: UpdateAuthPasswordState,
  formData: FormData
): Promise<UpdateAuthPasswordState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  // Match Supabase's own default: 6+ chars. The dashboard lets you
  // raise this; raise the validator here in sync.
  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }
  if (password !== confirm) {
    return { error: "Passwords don't match." };
  }

  // TODO future: require current-password reauthentication before
  // allowing a change. Not built into the Supabase SDK; would need a
  // separate signInWithPassword({ email: user.email, password: current })
  // round-trip and a rate-limiter to defend against brute force.
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  return { ok: true, message: "Password updated." };
}
