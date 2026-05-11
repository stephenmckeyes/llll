// ---------------------------------------------------------------------------
// /activities/[id]/edit — placeholder.
//
// Real edit form ships next turn; the entry points (Edit dialog buttons on
// the day rows) are already wired here. For now we show a stub so the
// links don't 404. `?section=rhythm` vs `?section=activity` toggles which
// section the future form opens to.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function EditActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const search = await searchParams;
  const section = search.section === "rhythm" ? "rhythm" : "activity";

  const { data: activity } = await supabase
    .from("activities")
    .select("id, name")
    .eq("id", id)
    .single();

  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col gap-6 p-6">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Mission
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          Edit {section}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {activity?.name ?? "Activity"}
        </p>
      </header>

      <section className="rounded-md border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        <p className="font-medium">Editor coming next.</p>
        <p className="mt-2">
          For now: if you need to change something, archive this activity
          from <Link href="/activities" className="underline">Manage</Link> and
          recreate it via{" "}
          <Link href="/activities/new" className="underline">Add Activity</Link>.
        </p>
        <p className="mt-4 text-xs text-zinc-500">
          When the editor ships, &ldquo;Edit activity&rdquo; will change name /
          notes / tags / dates / times / priority; &ldquo;Edit rhythm&rdquo;
          will let you swap the rhythm with an option to apply to future
          occurrences only (preserving the past for history).
        </p>
      </section>
    </main>
  );
}
