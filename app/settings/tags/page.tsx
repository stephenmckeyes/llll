// ---------------------------------------------------------------------------
// /settings/tags — active + archived tag management.
//
// Archiving a tag hides it from the picker and every filter surface
// but preserves the row (and the tag name inside every activity /
// completion history that already references it — old banners keep
// rendering with the right color). "Restore" un-archives.
//
// Active section lists archivable tags with a "used by N activities"
// count. Archived section is a compact list with restore buttons.
// ---------------------------------------------------------------------------

import { requireOnboardedUser } from "@/lib/auth/require-onboarded-user";

import { SettingsShell } from "../_settings-shell";
import { TagList } from "./tag-list";

export default async function TagsSettingsPage() {
  const { supabase, user } = await requireOnboardedUser();

  // Tags (active + archived) + per-name usage across the user's
  // active activities. Usage is only informative for the active
  // section; archived rows don't get a count.
  const [{ data: tagRows }, { data: activityTagRows }] = await Promise.all([
    supabase
      .from("tags")
      .select("id, name, color, archived_at")
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

  type Row = {
    id: string;
    name: string;
    color: string;
    archived_at: string | null;
  };
  const rows = (tagRows ?? []) as Row[];
  const active = rows
    .filter((r) => !r.archived_at)
    .map((r) => ({ ...r, usageCount: usage.get(r.name) ?? 0 }));
  const archived = rows
    .filter((r) => Boolean(r.archived_at))
    .map((r) => ({ ...r, usageCount: 0 }));

  return (
    <SettingsShell title="Tags">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Tags label your activities and color their calendar banners.
        Archiving a tag hides it from the picker and every filter, but
        the tag name stays on any activity or completion history that
        already referenced it. Restore any time from below.
      </p>
      <TagList
        activeTags={active}
        archivedTags={archived}
      />
    </SettingsShell>
  );
}
