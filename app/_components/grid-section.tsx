"use client";

// ---------------------------------------------------------------------------
// GridSection — client wrapper for the Grid view.
//
// Owns the tag-filter state and renders both:
//   1. The sticky GridNavigator (date controls + Unlabeled chip +
//      inline TagFilterPopover so the filter sits next to the date
//      controls and doesn't add a separate toolbar row).
//   2. The GridTable, receiving rows already filtered by the
//      current hidden-tags set.
//
// GridTable still owns its own internal state (per-row off toggle,
// modal open instance, click-to-sort state). GridSection ONLY
// manages the tag filter — that's the one piece that needs to be
// rendered visually inside GridNavigator while still influencing
// the table below.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";

import type { TagMap } from "@/lib/domain/tags";

import {
  GridTable,
  TagFilterPopover,
  type DateCol,
  type GridMode,
  type GridRow,
} from "./grid-table";
import { GridNavigator } from "./grid-navigator";
import type { DayInstance } from "./day-list";
import type { IncompleteInfo } from "./incomplete-button";

type GridRange = "week" | "month" | "total";

export function GridSection({
  // Navigator props
  range,
  currentDate,
  prevDate,
  nextDate,
  label,
  incompleteInfo,
  // Table props
  mode,
  rows,
  dateCols,
  todayStr,
  rangeLabel,
  singlesDone,
  singlesTotal,
  singles,
  userId,
  tagMap,
}: {
  range: GridRange;
  currentDate: string;
  prevDate: string;
  nextDate: string;
  label: string;
  incompleteInfo: IncompleteInfo;
  mode: GridMode;
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  rangeLabel: string;
  singlesDone: number;
  singlesTotal: number;
  singles: DayInstance[];
  userId: string;
  tagMap: TagMap;
}) {
  // Tag filter state. Stored as a HIDDEN set so the default
  // (everything visible) is the empty set — new tags added to
  // activities later automatically show without needing opt-in.
  // The pseudo-name "__none__" controls whether activities with no
  // tags at all appear.
  const [hiddenTags, setHiddenTags] = useState<ReadonlySet<string>>(
    new Set()
  );

  const allTagNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) for (const t of r.activity.tags) s.add(t);
    return Array.from(s).sort();
  }, [rows]);

  const visibleRows = useMemo(() => {
    return rows.filter((r) => {
      if (r.activity.tags.length === 0) {
        return !hiddenTags.has("__none__");
      }
      // OR semantics: an activity shows if ANY of its tags is visible.
      return r.activity.tags.some((t) => !hiddenTags.has(t));
    });
  }, [rows, hiddenTags]);

  function toggleHiddenTag(name: string) {
    setHiddenTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function selectAll() {
    setHiddenTags(new Set());
  }
  function deselectAll() {
    // Hide every tag name + the tagless pseudo-entry, so the user
    // sees zero rows by default and re-checks the few they want.
    setHiddenTags(new Set([...allTagNames, "__none__"]));
  }

  return (
    <>
      {/* Inline sticky wrapper — matches the StickyNav used by the
          other (non-grid) views in page.tsx. Sticks at top-[5rem]
          (just below the ViewSwitcher's ~80px-tall sticky band),
          with bg + horizontal bleed via -mx-6 / px-6 so scrolled
          content doesn't leak through. */}
      <div className="sticky top-[5rem] z-20 -mx-6 bg-white px-6 py-2 dark:bg-zinc-950">
        <GridNavigator
          range={range}
          currentDate={currentDate}
          prevDate={prevDate}
          nextDate={nextDate}
          label={label}
          incompleteInfo={incompleteInfo}
        >
          <TagFilterPopover
            tagNames={allTagNames}
            hiddenTags={hiddenTags}
            tagMap={tagMap}
            onToggle={toggleHiddenTag}
            onSelectAll={selectAll}
            onDeselectAll={deselectAll}
          />
        </GridNavigator>
      </div>

      <GridTable
        mode={mode}
        rows={visibleRows}
        dateCols={dateCols}
        todayStr={todayStr}
        rangeLabel={rangeLabel}
        singlesDone={singlesDone}
        singlesTotal={singlesTotal}
        singles={singles}
        userId={userId}
        tagMap={tagMap}
      />
    </>
  );
}
