// ---------------------------------------------------------------------------
// /activities/new — add a new activity (the unified producer for what
// used to be habits AND tasks).
// ---------------------------------------------------------------------------

import Link from "next/link";
import { redirect } from "next/navigation";

import { buildTagMap } from "@/lib/domain/tags";
import { createClient } from "@/lib/supabase/server";

import { ActivityForm } from "./activity-form";

export default async function NewActivityPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch the user's tag palette so the TagPicker can render existing
  // tags inline (no client-side fetch on first paint).
  const { data: tagRows } = await supabase
    .from("tags")
    .select("id, name, color");
  const tagMap = buildTagMap(
    (tagRows ?? []) as Array<{ id: string; name: string; color: string }>
  );

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-xl flex-col gap-6 p-6">
      <header className="space-y-1">
        <Link
          href="/"
          className="text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Mission
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Add Activity</h1>
      </header>

      <ActivityForm initialTagMap={tagMap} />
    </main>
  );
}
