// ---------------------------------------------------------------------------
// Home page (/) — Server Component.
// Reads the current user from Supabase and shows one of two states:
//   - logged in: greeting + sign-out
//   - logged out: marketing-y blurb + sign-in/sign-up links
// ---------------------------------------------------------------------------

import Link from "next/link";

import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-8 p-6">
      <header className="space-y-2">
        <h1 className="text-4xl font-semibold tracking-tight">Mission</h1>
        <p className="text-base text-zinc-600 dark:text-zinc-400">
          Track what you actually do — planned or not.
        </p>
      </header>

      {user ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Signed in as
          </p>
          <p className="font-medium">{user.email}</p>

          <form action={signOut} className="mt-4">
            <button
              type="submit"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Sign out
            </button>
          </form>

          <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-500">
            The today view and activity-creation forms come next.
          </p>
        </section>
      ) : (
        <section className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="rounded-md bg-zinc-900 px-4 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-md border border-zinc-300 px-4 py-2 text-center text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Sign up
          </Link>
        </section>
      )}
    </main>
  );
}
