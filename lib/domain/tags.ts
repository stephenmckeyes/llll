// ---------------------------------------------------------------------------
// Tag color palette + Tailwind-class mappings.
//
// Tag colors are stored in the DB as palette KEYS ("emerald", "sky", ...)
// rather than raw hex codes. This lets us:
//
//   1. Map cleanly to Tailwind classes for both light and dark modes.
//      Each palette entry has matched chip / dot / text variants so
//      colors stay legible against either background.
//   2. Swap the palette globally without touching DB data.
//   3. Stay safe with Tailwind's content scanner — every class name we
//      need is statically listed below; nothing is built via string
//      interpolation that the scanner can't see.
//
// Why these 12: span the rainbow, all readable on white + dark zinc, and
// distinguishable side-by-side. If we ever need more, add inline; the
// existing keys are stable so older DB rows keep working.
// ---------------------------------------------------------------------------

export const TAG_COLORS = [
  "emerald",
  "sky",
  "amber",
  "red",
  "violet",
  "blue",
  "pink",
  "orange",
  "lime",
  "teal",
  "fuchsia",
  "gray",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

/** Fallback color used when an activity references a tag name that has
 *  no row in the `tags` table yet (legacy free-text tags, or freshly-
 *  typed names that haven't been saved with a color). */
export const TAG_COLOR_FALLBACK: TagColor = "gray";

export type TagInfo = {
  id: string;
  name: string;
  color: TagColor;
  /** How many active activities currently have this tag in their
   *  default_skill_tags[]. Used to sort the picker's "Most frequent"
   *  list. Zero for never-used tags. */
  usage: number;
};

/** Lookup map keyed by tag NAME. The shape passed through React props
 *  from server-rendered pages → client components. */
export type TagMap = Record<string, TagInfo>;

/**
 * Resolve a tag name to its color. Returns the fallback gray when the
 * name has no entry in the lookup — keeps the UI rendering instead of
 * breaking on legacy data.
 */
export function tagColorFor(name: string, tags: TagMap): TagColor {
  return tags[name]?.color ?? TAG_COLOR_FALLBACK;
}

/**
 * Validate a string as a known palette key. Used at the server-action
 * boundary so we never write a typo or arbitrary string into the DB.
 */
export function isValidTagColor(s: string): s is TagColor {
  return (TAG_COLORS as readonly string[]).includes(s);
}

/**
 * Turn raw DB rows into a TagMap. Unknown / typo colors gracefully
 * degrade to the fallback gray so a corrupt color value can never
 * crash the render.
 *
 * Optional `usageByName` map (name → count) feeds the "Most frequent"
 * sort in the picker. Pages that don't care about usage can omit it
 * and every tag's `usage` defaults to 0.
 */
export function buildTagMap(
  rows: ReadonlyArray<{ id: string; name: string; color: string }>,
  usageByName: ReadonlyMap<string, number> = new Map()
): TagMap {
  const map: TagMap = {};
  for (const r of rows) {
    const color: TagColor = isValidTagColor(r.color)
      ? r.color
      : TAG_COLOR_FALLBACK;
    map[r.name] = {
      id: r.id,
      name: r.name,
      color,
      usage: usageByName.get(r.name) ?? 0,
    };
  }
  return map;
}

/**
 * Aggregate per-tag usage from a list of activities. Each tag in an
 * activity's `default_skill_tags[]` contributes one count. Tags that
 * appear in `default_skill_tags` but have no matching `tags` row are
 * still counted — the picker's recent list shows them as gray-fallback
 * chips, which is the right behavior for legacy free-text tags.
 */
export function computeTagUsage(
  activities: ReadonlyArray<{ default_skill_tags: string[] | null | undefined }>
): Map<string, number> {
  const usage = new Map<string, number>();
  for (const a of activities) {
    for (const name of a.default_skill_tags ?? []) {
      usage.set(name, (usage.get(name) ?? 0) + 1);
    }
  }
  return usage;
}

// ---------------------------------------------------------------------------
// Tailwind class mappings. EVERY className you might need from these
// helpers MUST appear literally in source somewhere — Tailwind's content
// scanner can't pick up `bg-${color}-100` style strings.
// ---------------------------------------------------------------------------

/**
 * Classes for a "chip" — a small rectangle with text inside (e.g., the
 * Day view banner tags, the modal details list, the Archive tag chips).
 * Includes background, text color, and a subtle ring for definition.
 */
export function tagChipClasses(color: TagColor): string {
  switch (color) {
    case "emerald":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200";
    case "sky":
      return "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200";
    case "amber":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
    case "red":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    case "violet":
      return "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200";
    case "blue":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "pink":
      return "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200";
    case "orange":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
    case "lime":
      return "bg-lime-100 text-lime-800 dark:bg-lime-900 dark:text-lime-200";
    case "teal":
      return "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200";
    case "fuchsia":
      return "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900 dark:text-fuchsia-200";
    case "gray":
      return "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  }
}

/**
 * Classes for a solid dot — the tiny markers on Week banners and
 * Month cells. Just a background color, sized at the call site.
 */
export function tagDotClasses(color: TagColor): string {
  switch (color) {
    case "emerald":
      return "bg-emerald-500";
    case "sky":
      return "bg-sky-500";
    case "amber":
      return "bg-amber-500";
    case "red":
      return "bg-red-500";
    case "violet":
      return "bg-violet-500";
    case "blue":
      return "bg-blue-500";
    case "pink":
      return "bg-pink-500";
    case "orange":
      return "bg-orange-500";
    case "lime":
      return "bg-lime-500";
    case "teal":
      return "bg-teal-500";
    case "fuchsia":
      return "bg-fuchsia-500";
    case "gray":
      return "bg-zinc-400";
  }
}

/**
 * Used inside the color picker — solid swatch with a ring on hover so
 * the user can see what's selectable. The selected state gets a
 * thicker ring (added by the caller).
 */
export function tagSwatchClasses(color: TagColor): string {
  // Same as the dot but with a hover affordance.
  return `${tagDotClasses(color)} ring-offset-2 hover:ring-2 hover:ring-zinc-400 dark:hover:ring-zinc-500 dark:ring-offset-zinc-900`;
}
