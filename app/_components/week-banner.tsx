// ---------------------------------------------------------------------------
// WeekBannerPill — the shared Week-view banner atom used by the personal
// dashboard, the friend view, and the community calendar. One activity
// occurrence rendered as a compact colored pill (name + optional time + tag
// dots), colored by status.
//
// Interaction wrapper stays per-surface: the personal Week wraps the whole
// day cell in a Link, the friend/community Week wraps each pill in a button.
// This component owns only the LOOK, so the three surfaces can't drift.
// ---------------------------------------------------------------------------

import { TagDotRow } from "@/app/_components/tag-chip";
import type { OccurrenceStatus } from "@/lib/domain/calendar-view";
import type { TagMap } from "@/lib/domain/tags";

export function WeekBannerPill({
  name,
  firstTime,
  tags,
  status,
  tagMap,
  isSpan = false,
  connectLeft = false,
  connectRight = false,
}: {
  name: string;
  firstTime?: string | null;
  tags: string[];
  status: OccurrenceStatus;
  tagMap: TagMap;
  /** Multi-day event: draw as a connected bar; the name prints once at the
   *  start of the run, and the sides that continue into an adjacent day are
   *  squared off (rounded only at the true ends / week edges). */
  isSpan?: boolean;
  connectLeft?: boolean;
  connectRight?: boolean;
}) {
  const done = status === "completed";
  const missed = status === "missed";
  const cls = done
    ? "bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-900 dark:text-zinc-600"
    : missed
      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
      : "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900";

  if (isSpan) {
    const roundL = connectLeft ? "rounded-l-none" : "rounded-l";
    const roundR = connectRight ? "rounded-r-none" : "rounded-r";
    return (
      <span
        className={`block min-w-0 overflow-hidden px-1 py-0.5 text-[9px] font-medium leading-tight ${roundL} ${roundR} ${cls}`}
        title={`${name}${firstTime ? ` @ ${firstTime}` : ""}`}
      >
        {/* Name only at the start of the run; continuation keeps bar height. */}
        <span className="block truncate">{connectLeft ? " " : name}</span>
      </span>
    );
  }

  return (
    <span
      className={`block min-w-0 overflow-hidden rounded px-1 py-0.5 text-[9px] leading-tight ${cls}`}
      title={`${name}${firstTime ? ` @ ${firstTime}` : ""}${
        tags.length > 0 ? ` · ${tags.join(", ")}` : ""
      }`}
    >
      <span className="block line-clamp-2 break-words font-medium">{name}</span>
      {firstTime && <span className="block opacity-75">{firstTime}</span>}
      {tags.length > 0 && (
        <TagDotRow names={tags} tags={tagMap} dotClassName="h-1 w-1" max={4} />
      )}
    </span>
  );
}
