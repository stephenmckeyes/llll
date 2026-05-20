// ---------------------------------------------------------------------------
// TagChip + TagDot — small display primitives for tags throughout the app.
//
// Both work with the per-page `tags` lookup map, so the color of every
// tag is consistent across views without any prop drilling beyond the
// page level. Unknown names render with the gray fallback, never error.
//
// Server-friendly (no client hooks needed). Pure renderers.
// ---------------------------------------------------------------------------

import {
  tagChipClasses,
  tagColorFor,
  tagDotClasses,
  type TagMap,
} from "@/lib/domain/tags";

/**
 * Pill-shaped chip with the tag name. Used in:
 *   - Day view banners (under the activity name)
 *   - Activity modal details
 *   - Archive cards
 *   - Grid view Tags popup
 */
export function TagChip({
  name,
  tags,
  size = "sm",
}: {
  name: string;
  tags: TagMap;
  size?: "xs" | "sm";
}) {
  const color = tagColorFor(name, tags);
  const sizeCls =
    size === "xs"
      ? "px-1 py-px text-[10px]"
      : "px-1.5 py-0.5 text-[11px]";
  return (
    <span
      className={`inline-block rounded-full font-medium ${sizeCls} ${tagChipClasses(color)}`}
      title={name}
    >
      {name}
    </span>
  );
}

/**
 * Tiny solid dot — used where chips wouldn't fit:
 *   - Week-view banners (one per tag, before the activity name)
 *   - Month-view cells (cluster at the bottom)
 *
 * Defaults to 8px square, but the caller can override with `className`
 * to make it even smaller (Month cells use h-1 w-1 = 4px).
 */
export function TagDot({
  name,
  tags,
  className = "h-2 w-2",
}: {
  name: string;
  tags: TagMap;
  className?: string;
}) {
  const color = tagColorFor(name, tags);
  return (
    <span
      aria-hidden
      title={name}
      className={`inline-block rounded-full ${className} ${tagDotClasses(color)}`}
    />
  );
}

/**
 * Render a horizontal list of chips. Handles the empty case gracefully
 * (renders nothing rather than an empty wrapper).
 */
export function TagChipList({
  names,
  tags,
  size = "sm",
}: {
  names: string[];
  tags: TagMap;
  size?: "xs" | "sm";
}) {
  if (names.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {names.map((n) => (
        <TagChip key={n} name={n} tags={tags} size={size} />
      ))}
    </span>
  );
}

/**
 * Render a row of dots for compact surfaces. The `max` limits how many
 * fit before showing "+N" overflow — used in Month cells where space
 * is precious.
 */
export function TagDotRow({
  names,
  tags,
  dotClassName = "h-1.5 w-1.5",
  max = 4,
}: {
  names: string[];
  tags: TagMap;
  dotClassName?: string;
  max?: number;
}) {
  if (names.length === 0) return null;
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span className="inline-flex items-center gap-0.5">
      {shown.map((n) => (
        <TagDot key={n} name={n} tags={tags} className={dotClassName} />
      ))}
      {extra > 0 && (
        <span className="text-[8px] font-medium text-zinc-500">+{extra}</span>
      )}
    </span>
  );
}
