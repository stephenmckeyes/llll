// ---------------------------------------------------------------------------
// /settings/tags — list + delete tags.
//
// The list is server-rendered against `tags` + a per-tag "used by N
// activities" count. Delete happens via the shared TagList client
// component, which opens a confirm dialog before firing the server
// action.
// ---------------------------------------------------------------------------

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { SettingsShell } from "../_settings-shell";
import { TagList } from "./tag-list";

export default async function TagsSettingsPage() {
  const { supabase, user } = await requireOnboardedUser();

  // Tags + a rough "used by N activities" count. Query pulls all
  // activity default_skill_tags for the user in one shot; we do the
  // per-name tally in JS to avoid needing a separate RPC.
  const [{ data: tagRows }, { data: activityTagRows }] = await Promise.all([
    supabase
      .from("tags")
      .select("id, name, color")
      .eq("user_id", user.id)
      .order("name", { ascending: true }),
    supabase
      .from("activities")
      .select("default_skill_tags")
      .eq("user_id", user.id)
      .is("archived_at", null),
  ]);

  const usage = new Map<string, number>();
  for (const row of (activityTagRows ?? []) as Array<{
    default_skill_tags: string[] | null;
  }>) {
    for (const t of row.default_skill_tags ?? []) {
      usage.set(t, (usage.get(t) ?? 0) + 1);
    }
  }

  const tags = ((tagRows ?? []) as Array<{
    id: string;
    name: string;
    color: string;
  }>).map((t) => ({ ...t, usageCount: usage.get(t.name) ?? 0 }));

  return (
    <SettingsShell title="Tags">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Tags label your activities and color their calendar banners.
        Deleting a tag removes it from every activity and completion
        history that currently references it. This can&rsquo;t be
        undone.
      </p>
      <TagList tags={tags} />
    </SettingsShell>
  );
}
