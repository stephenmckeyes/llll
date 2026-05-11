// ---------------------------------------------------------------------------
// /activities/new — create a recurring activity.
// Server Component shell; the interactive form is a Client Component sibling.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { ActivityForm } from "./activity-form";

export default async function NewActivityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col gap-6 p-6">
      <header className="space-y-1">
        <Link
          href="/today"
          className="text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Today
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">New activity</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Define what you want to do and how often. You can edit or archive
          it later.
        </p>
      </header>

      <ActivityForm />
    </main>
  );
}
