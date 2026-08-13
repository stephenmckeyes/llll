// ---------------------------------------------------------------------------
// MonthCell + banner primitives — shared by the server-rendered
// MonthView (fetched inline in page.tsx for the initial month) and
// the client-rendered MonthList (endless-scroll many months with
// lazy activity loading). Extracted so both call sites stay in
// visual + behavioral lockstep without dragging page.tsx across
// the client boundary.
// ---------------------------------------------------------------------------

import Link from "next/link";

import { tagChipClasses, type TagMap } from "@/lib/domain/tags";

// Per-instance banner shape used by MonthCell. Carries the activity
// name so the cell can render real text, not just a status box.
export type MonthBanner = {
  id: string;
  name: string;
  status: string;
  tags: string[];
};

// How many activity-name banners fit inside one month cell before we
// collapse the rest into an overflow line. Two is a comfortable read
// for the cell heights at 7-col layout; on mobile (narrower cells)
// the second banner still fits because cells are wider than tall.
export const MONTH_BANNERS_PER_CELL = 2;

// Server-render + client-scroll window sizes for the endless-scroll
// Month/Year views. Kept here (a shared module with no "use client"
// directive) so page.tsx MonthView / YearView — server components —
// can read them at build time. Importing them from a "use client"
// module resolved to `undefined` on the server, which crashed the
// eager-fetch loops.
export const MONTH_INITIAL_RADIUS = 3;
export const YEAR_INITIAL_RADIUS = 1;

export function MonthCell({
  date,
  dateStr,
  inMonth,
  isToday,
  instances,
  tagMap,
}: {
  date: Date;
  dateStr: string;
  inMonth: boolean;
  isToday: boolean;
  instances: MonthBanner[];
  tagMap: TagMap;
}) {
  const hasAny = instances.length > 0;
  const visible = instances.slice(0, MONTH_BANNERS_PER_CELL);
  const hidden = instances.slice(MONTH_BANNERS_PER_CELL);

  const overflowSummary = hidden.length > 0 ? summarizeOverflow(hidden) : null;

  let cls =
    "relative flex min-h-20 flex-col gap-0.5 rounded p-1 text-xs transition-colors";
  if (!inMonth) cls += " text-zinc-400 dark:text-zinc-600";
  else cls += " text-zinc-700 dark:text-zinc-300";
  if (isToday) cls += " ring-1 ring-zinc-900 dark:ring-zinc-50";
  if (hasAny && inMonth) cls += " bg-zinc-50 dark:bg-zinc-950";

  return (
    <div className={cls}>
      <Link
        href={`/?view=day&date=${dateStr}`}
        aria-label={`Open ${dateStr}`}
        className="absolute inset-0 z-0 rounded hover:bg-zinc-100 dark:hover:bg-zinc-900"
      />
      <span
        className={`relative z-10 pointer-events-none self-start ${
          isToday ? "font-semibold" : ""
        }`}
      >
        {date.getDate()}
      </span>
      {inMonth && hasAny && (
        <div className="relative z-10 flex flex-col gap-0.5">
          {visible.map((inst) => (
            <MonthBannerPill key={inst.id} banner={inst} tagMap={tagMap} />
          ))}
          {overflowSummary && (
            <span className="pointer-events-none truncate text-[9px] font-medium text-zinc-500 dark:text-zinc-400">
              {overflowSummary}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function MonthBannerPill({
  banner,
  tagMap,
}: {
  banner: MonthBanner;
  tagMap: TagMap;
}) {
  const firstTag = banner.tags[0];
  const tagInfo = firstTag ? tagMap[firstTag] : undefined;
  const colorCls = tagInfo
    ? tagChipClasses(tagInfo.color)
    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

  let glyph = "";
  let extraCls = "";
  if (banner.status === "completed") glyph = "✓ ";
  else if (banner.status === "missed") {
    glyph = "✗ ";
    extraCls = " line-through opacity-70";
  } else if (banner.status === "pending") {
    glyph = "· ";
  }

  return (
    <span
      title={banner.name}
      className={`pointer-events-none truncate rounded-sm px-1 py-0.5 text-[10px] font-medium leading-tight ${colorCls}${extraCls}`}
    >
      {glyph}
      {banner.name}
    </span>
  );
}

export function summarizeOverflow(hidden: MonthBanner[]): string {
  const counts: Record<string, number> = {};
  for (const b of hidden) {
    const key = b.tags[0] ?? "(untagged)";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 2);
  const summarized = top.map(([name, n]) => `+${n} ${name}`).join(" · ");
  const remainder = entries.length > 2 ? ` · +${entries.length - 2}…` : "";
  return summarized + remainder;
}
