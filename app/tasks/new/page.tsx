// ---------------------------------------------------------------------------
// /tasks/new — create a one-off task.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { TaskForm } from "./task-form";

export default async function NewTaskPage() {
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
        <h1 className="text-3xl font-semibold tracking-tight">New task</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          One-off intent with an optional deadline or window.
        </p>
      </header>

      <TaskForm />
    </main>
  );
}
