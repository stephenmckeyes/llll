// ---------------------------------------------------------------------------
// /onboarding — first-time-user setup screen.
//
// Server-shell that handles the auth check + the "already onboarded?
// bounce home" check, then renders the actual form as a client
// component (because TZ auto-detection requires Intl.DateTimeFormat in
// the browser).
// ---------------------------------------------------------------------------

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // If the user is already onboarded, bounce straight home — we don't
  // want to let them re-enter the form and accidentally overwrite their
  // timezone. (Future: when /settings grows a TZ control, this stops
  // being a concern.)
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarded_at")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.onboarded_at) redirect("/");

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center gap-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome to Mission
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          A few quick details before we get started. You can change
          everything later in Settings.
        </p>
      </header>

      <OnboardingForm initialEmail={user.email ?? ""} />

      {/* Quick "install as an app" tip — shown once, during first
          sign-in. Mission is a website, but adding it to the home
          screen makes it open full-screen like a native app. */}
      <section className="rounded-md border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-medium">Add Mission to your home screen</h2>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          For an app-like, full-screen experience, add Mission to your
          phone&rsquo;s home screen:
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-zinc-600 dark:text-zinc-400">
          <li>
            <strong>iPhone (Safari):</strong> tap the Share button, then{" "}
            <em>Add to Home Screen</em>.
          </li>
          <li>
            <strong>Android (Chrome):</strong> tap the ⋮ menu, then{" "}
            <em>Add to Home screen</em>.
          </li>
        </ul>
      </section>
    </main>
  );
}
