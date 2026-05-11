// ---------------------------------------------------------------------------
// Server Actions for authentication.
//
// "use server" at the top marks every export as a Server Action — they run
// only on the server, never in the browser, even when called from a
// Client Component form. The browser only sees the call site, not the body.
//
// Pattern (React 19): each form action takes (prevState, formData) and
// returns either null (success → followed by redirect) or { error: string }
// for inline display. useActionState() on the client side surfaces that.
// ---------------------------------------------------------------------------

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const credentialsSchema = z.object({
  email: z.email("Please enter a valid email."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters."),
});

export type AuthState = { error: string } | { success: string } | null;

// ---------------------------------------------------------------------------
// signUp — creates a new auth user. The handle_new_auth_user() trigger we
// added in migration 0001 will auto-create the matching profiles row.
//
// If "Confirm email" is OFF in Supabase Auth settings, the user is signed
// in immediately (data.session present) and we redirect home. If it's ON,
// no session yet — we return a "check your email" message instead.
// ---------------------------------------------------------------------------

export async function signUp(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) return { error: error.message };

  if (data.session) {
    // Email confirmation disabled → user is already signed in.
    revalidatePath("/", "layout");
    redirect("/");
  }

  // Email confirmation required.
  return {
    success:
      "Account created. Check your email for a confirmation link, then log in.",
  };
}

// ---------------------------------------------------------------------------
// signIn — exchanges email + password for a session cookie.
// ---------------------------------------------------------------------------

export async function signIn(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/");
}

// ---------------------------------------------------------------------------
// signOut — clears the session cookie and bounces to /login.
// No state needed; called from a plain <form action={signOut}>.
// ---------------------------------------------------------------------------

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
