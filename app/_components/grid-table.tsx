"use client";

// ---------------------------------------------------------------------------
// GridTable — the actual table rendered by the Grid (habit-tracker) view.
//
// Layout per mode:
//   - Week:  one row of 7 cells per activity, cells capped at ~22px so the
//            whole row is one visual line (no wrapping). Glyphs visible.
//   - Month: a 7-COL row-major mini-calendar (Mon..Sun across, weeks down).
//            Days sit in their actual weekday columns — the most
//            intuitive layout for a calendar month. Cells ~14px square.
//   - Total: a 7-ROW column-major heatmap. Each column is a calendar
//            week (Mon..Sun top to bottom). Cells SCALE: capped at
//            ~12px each for new users (few weeks of history → bigger,
//            more legible squares) but shrink down to fit the
//            container for power users with hundreds of weeks. Row
//            height varies with cell size since cells stay square.
//
// Cells: aspect-square inside a grid whose total `maxWidth` is
// `weekCount * MAX_CELL_PX + gaps`. The grid is `1fr` columns, so
// when content fits within maxWidth cells are at the cap; when content
// exceeds the container width, cells shrink uniformly to fit. No
// horizontal scrollbars at typical user scales.
//
// Cell click — always opens the ActivityModal.
// Hover  — custom 3-line tooltip: status / activity name / "DD Mon YYYY".
// Per-row slide toggle (replaces the old hide-footer): off collapses
// the row to just [name + toggle], on shows everything.
// ---------------------------------------------------------------------------

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { summarizeRhythm } from "@/lib/domain/rhythm-summary";
import { tagDotClasses, type TagMap } from "@/lib/domain/tags";

import { ActivityModal } from "./activity-modal";
import type { DayInstance } from "./day-list";
import { TagChipList } from "./tag-chip";

export type GridCellState =
  | "completed"
  | "missed"
  | "overdue"
  | "scheduled"
  | "not-scheduled"
  | "outside";

export type GridCell = {
  state: GridCellState;
  dateStr: string;
  instance: DayInstance | null;
};

export type GridRow = {
  /** activity.tags = tag NAMES; color resolved against the page-level tagMap. */
  activity: { id: string; name: string; tags: string[] };
  rhythmCategory: string;
  cells: GridCell[];
  pct: number | null;
  done: number;
  missed: number;
  unlabeled: number;
  onTheHook: number;
  /** Consecutive completed instances ending at the latest past-or-current
   *  scheduled occurrence. 0 means the current run is broken. */
  streak: number;
};

export type DateCol = { date: Date; dateStr: string };

export type GridMode = "week" | "month" | "total";

/** Sort keys for the toolbar dropdown. "alpha" is the default. */
export type GridSortKey =
  | "alpha"
  | "done-desc"
  | "streak-desc"
  | "pct-desc"
  | "pct-asc";

// Cell-size caps per mode (pixels). MAX cell width; actual size is
// min(cap, container_width / cols). Total uses a hard cap so the
// heatmap scales for long histories (tiny squares for power users,
// bigger for new users). Week and Month don't cap — they let cells
// fill the entire available column horizontally via `1fr` columns.
const TOTAL_CELL_MAX_PX = 12;
const WEEK_CELL_GAP_PX = 4;
const MONTH_CELL_GAP_PX = 4;
const TOTAL_CELL_GAP_PX = 1;

// Each mode's cells use this aspect ratio. Week stays square. Month
// uses a wide-rectangle shape so a 5-week calendar grid doesn't tower
// to a 200+px row height; the row stays compact and more activities
// fit on-screen. Total stays square since its cells are tiny.
const WEEK_CELL_ASPECT = "aspect-square";
const MONTH_CELL_ASPECT = "aspect-[2/1]"; // 2:1, wider than tall
const TOTAL_CELL_ASPECT = "aspect-square";

// Sticky-thead offset. ViewSwitcher (top-0, ~100px tall incl. py-2)
// + Navigator (top-[6.25rem], ~72px tall) stack at the top of the
// viewport. The grid's thead pins just below them at ~172px. If
// either of those layouts changes height, adjust this offset to
// match.
const STICKY_THEAD_TOP = "top-[10.75rem]";

// ---------------------------------------------------------------------------

export function GridTable({
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
  mode: GridMode;
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  rangeLabel: string;
  singlesDone: number;
  singlesTotal: number;
  /** Every one-time activity instance in range, expanded under the banner. */
  singles: DayInstance[];
  userId: string;
  /** Name → color lookup; threaded into the per-row Tags popover and
   *  the ActivityModal opened from a clicked cell. */
  tagMap: TagMap;
}) {
  const [openInstance, setOpenInstance] = useState<DayInstance | null>(null);
  const { off, toggle } = useRowOffSet(userId);

  // ---- Sort + filter (client state) -------------------------------------
  const [sortKey, setSortKey] = useState<GridSortKey>("alpha");
  // Tag filter is stored as a HIDDEN set rather than a "selected" set
  // so the default (everything visible) is the empty set — which means
  // new tags added later automatically show without needing an opt-in.
  // The pseudo-name "__none__" controls whether activities with no
  // tags at all appear.
  const [hiddenTags, setHiddenTags] = useState<ReadonlySet<string>>(
    new Set()
  );

  // All distinct tag names across the row set, sorted A→Z. We also
  // surface "__none__" as a synthetic entry so the user can hide
  // tagless activities if they want.
  const allTagNames = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) for (const t of r.activity.tags) s.add(t);
    return Array.from(s).sort();
  }, [rows]);

  const visibleRows = useMemo(() => {
    // Apply filter first, then sort.
    const filtered = rows.filter((r) => {
      if (r.activity.tags.length === 0) {
        return !hiddenTags.has("__none__");
      }
      // "Show if ANY of its tags is still visible" — per the spec,
      // unchecking a tag hides activities whose ONLY tags are unchecked.
      return r.activity.tags.some((t) => !hiddenTags.has(t));
    });
    const sorted = [...filtered];
    switch (sortKey) {
      case "alpha":
        sorted.sort((a, b) =>
          a.activity.name.localeCompare(b.activity.name)
        );
        break;
      case "done-desc":
        sorted.sort((a, b) => b.done - a.done);
        break;
      case "streak-desc":
        sorted.sort((a, b) => b.streak - a.streak);
        break;
      case "pct-desc":
        // Null pct (no on-the-hook in range) sinks to the bottom.
        sorted.sort((a, b) => {
          const pa = a.pct ?? -1;
          const pb = b.pct ?? -1;
          return pb - pa;
        });
        break;
      case "pct-asc":
        sorted.sort((a, b) => {
          const pa = a.pct ?? Number.POSITIVE_INFINITY;
          const pb = b.pct ?? Number.POSITIVE_INFINITY;
          return pa - pb;
        });
        break;
    }
    return sorted;
  }, [rows, hiddenTags, sortKey]);

  function toggleHiddenTag(name: string) {
    setHiddenTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }
  function selectAllTags() {
    setHiddenTags(new Set());
  }

  return (
    <>
      <GridToolbar
        sortKey={sortKey}
        onSortChange={setSortKey}
        tagNames={allTagNames}
        hiddenTags={hiddenTags}
        onToggleTag={toggleHiddenTag}
        onSelectAll={selectAllTags}
        tagMap={tagMap}
      />

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          No rhythmic activities active in this period. Add one, or pick a
          different time window.
        </p>
      ) : visibleRows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          No activities match the current tag filter.{" "}
          <button
            type="button"
            onClick={selectAllTags}
            className="font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
          >
            Show all
          </button>
          .
        </p>
      ) : mode === "week" ? (
        <WeekTable
          rows={visibleRows}
          dateCols={dateCols}
          todayStr={todayStr}
          off={off}
          onToggle={toggle}
          onOpenInstance={setOpenInstance}
          tagMap={tagMap}
        />
      ) : mode === "month" ? (
        <MonthTable
          rows={visibleRows}
          dateCols={dateCols}
          todayStr={todayStr}
          off={off}
          onToggle={toggle}
          onOpenInstance={setOpenInstance}
          tagMap={tagMap}
        />
      ) : (
        <TotalTable
          rows={visibleRows}
          dateCols={dateCols}
          todayStr={todayStr}
          off={off}
          onToggle={toggle}
          onOpenInstance={setOpenInstance}
          tagMap={tagMap}
        />
      )}

      <SinglesBanner
        done={singlesDone}
        total={singlesTotal}
        rangeLabel={rangeLabel}
        singles={singles}
        onOpenInstance={setOpenInstance}
      />

      <GridLegend />

      {openInstance && (
        <ActivityModal
          instance={openInstance}
          todayStr={todayStr}
          onClose={() => setOpenInstance(null)}
          tagMap={tagMap}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Per-user localStorage-backed off-set (rows toggled to "off").
// Same key the previous "hidden" set used.
// ---------------------------------------------------------------------------

const OFF_CHANGE_EVENT = "mission-grid-off-changed";
const EMPTY_OFF: ReadonlySet<string> = new Set();

function useRowOffSet(userId: string) {
  const key = `mission-grid-hidden:${userId}`;
  const cacheRef = useRef<{ raw: string | null; set: ReadonlySet<string> }>({
    raw: null,
    set: EMPTY_OFF,
  });

  const subscribe = useCallback((cb: () => void) => {
    if (typeof window === "undefined") return () => {};
    window.addEventListener(OFF_CHANGE_EVENT, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(OFF_CHANGE_EVENT, cb);
      window.removeEventListener("storage", cb);
    };
  }, []);

  const getSnapshot = useCallback((): ReadonlySet<string> => {
    if (typeof window === "undefined") return EMPTY_OFF;
    const raw = window.localStorage.getItem(key);
    if (raw === cacheRef.current.raw) return cacheRef.current.set;
    let set: ReadonlySet<string> = EMPTY_OFF;
    if (raw) {
      try {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr)) {
          set = new Set(arr.filter((v): v is string => typeof v === "string"));
        }
      } catch {
        // Corrupt JSON — pretend empty rather than crash.
      }
    }
    cacheRef.current = { raw, set };
    return set;
  }, [key]);

  const off = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_OFF);

  function toggle(id: string) {
    const next = new Set(off);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    try {
      window.localStorage.setItem(key, JSON.stringify(Array.from(next)));
      window.dispatchEvent(new Event(OFF_CHANGE_EVENT));
    } catch {
      // Quota / privacy mode — best-effort.
    }
  }

  return { off, toggle };
}

// ---------------------------------------------------------------------------
// WeekTable — single row of 7 cells, capped so the whole row is one line.
// ---------------------------------------------------------------------------

function WeekTable({
  rows,
  dateCols,
  todayStr,
  off,
  onToggle,
  onOpenInstance,
  tagMap,
}: {
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  off: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenInstance: (i: DayInstance) => void;
  tagMap: TagMap;
}) {
  // Cells fill the entire Activity-cells column horizontally via 1fr.
  // No hard cap — the column's auto width drives cell size. With
  // aspect-square cells AND name col line-clamp-1, the row stays
  // roughly one cell tall, regardless of name length.
  const gridStyle: React.CSSProperties = {
    gap: `${WEEK_CELL_GAP_PX}px`,
  };

  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
      <colgroup>
        <col className="w-[8rem]" />
        <col className="w-[4.5rem]" />
        <col />
        <col className="w-[5.5rem]" />
      </colgroup>
      <thead>
        <tr>
          <TH>Activity</TH>
          <TH>Type</TH>
          <TH>
            <div className="grid grid-cols-7" style={gridStyle}>
              {dateCols.map((c) => (
                <div
                  key={c.dateStr}
                  className={`text-center text-[10px] leading-tight ${
                    c.dateStr === todayStr
                      ? "font-semibold text-zinc-900 dark:text-zinc-50"
                      : "text-zinc-500"
                  }`}
                >
                  <div className="uppercase tracking-wide">
                    {c.date.toLocaleDateString(undefined, { weekday: "narrow" })}
                  </div>
                  <div>{c.date.getDate()}</div>
                </div>
              ))}
            </div>
          </TH>
          <TH className="text-center">Success</TH>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isOff = off.has(row.activity.id);
          return (
            <tr key={row.activity.id}>
              <NameCell
                row={row}
                isOff={isOff}
                onToggle={onToggle}
                linesMax={1}
              />
              {isOff ? (
                <CollapsedRow span={3} />
              ) : (
                <>
                  <TypeCell row={row} tagMap={tagMap} />
                  <td className="border-b border-zinc-100 px-1 py-0.5 align-middle dark:border-zinc-900">
                    <div className="grid grid-cols-7" style={gridStyle}>
                      {row.cells.map((cell) => (
                        <CellButton
                          key={cell.dateStr}
                          cell={cell}
                          todayStr={todayStr}
                          activityName={row.activity.name}
                          showGlyph={true}
                          aspectClass={WEEK_CELL_ASPECT}
                          onOpen={onOpenInstance}
                        />
                      ))}
                    </div>
                  </td>
                  <SuccessCell row={row} />
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// MonthTable — 7-COL row-major calendar grid. Days in their actual
// weekday columns (Mon..Sun). Padded so the 1st of the month lines up.
// ---------------------------------------------------------------------------

function MonthTable({
  rows,
  dateCols,
  todayStr,
  off,
  onToggle,
  onOpenInstance,
  tagMap,
}: {
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  off: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenInstance: (i: DayInstance) => void;
  tagMap: TagMap;
}) {
  const padBefore = dateCols.length > 0 ? mondayPad(dateCols[0].date) : 0;

  // Like Week: 1fr cells with aspect-square fill the column horizontally.
  // For a 5-week month at ~336px col width that's ~44px square cells —
  // big, distinct, calendar-y.
  const gridStyle: React.CSSProperties = {
    gap: `${MONTH_CELL_GAP_PX}px`,
  };

  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
      <colgroup>
        <col className="w-[8rem]" />
        <col className="w-[4.5rem]" />
        <col />
        <col className="w-[5.5rem]" />
      </colgroup>
      <thead>
        <tr>
          <TH>Activity</TH>
          <TH>Type</TH>
          <TH>
            <div className="grid grid-cols-7" style={gridStyle}>
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <div
                  key={i}
                  className="text-center text-[10px] font-medium text-zinc-400"
                >
                  {d}
                </div>
              ))}
            </div>
          </TH>
          <TH className="text-center">Success</TH>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isOff = off.has(row.activity.id);
          return (
            <tr key={row.activity.id}>
              <NameCell
                row={row}
                isOff={isOff}
                onToggle={onToggle}
                linesMax={3}
              />
              {isOff ? (
                <CollapsedRow span={3} />
              ) : (
                <>
                  <TypeCell row={row} tagMap={tagMap} />
                  {/* Month cells use a wider-than-tall aspect ratio so the
                      mini-calendar block doesn't tower over the rest of
                      the row. 5 weeks at 2:1 cells (~44 × 22 px) = ~120px
                      row height instead of the ~230px that aspect-square
                      cells would produce. */}
                  <td className="border-b border-zinc-100 px-1 py-0.5 align-top dark:border-zinc-900">
                    <div className="grid grid-cols-7" style={gridStyle}>
                      {Array.from({ length: padBefore }, (_, i) => (
                        <div
                          key={`pad-${i}`}
                          className={MONTH_CELL_ASPECT}
                        />
                      ))}
                      {row.cells.map((cell) => (
                        <CellButton
                          key={cell.dateStr}
                          cell={cell}
                          todayStr={todayStr}
                          activityName={row.activity.name}
                          showGlyph={true}
                          aspectClass={MONTH_CELL_ASPECT}
                          onOpen={onOpenInstance}
                        />
                      ))}
                    </div>
                  </td>
                  <SuccessCell row={row} />
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// TotalTable — 7-ROW column-major heatmap that SCALES.
//
// Each column = one calendar week (Mon..Sun top to bottom). The grid's
// maxWidth = weekCount * MAX_CELL_PX, with `1fr` columns inside — so:
//   - For new users (few weeks): the strip is naturally narrow at the
//     cap, cells sit at MAX_CELL_PX → big, legible.
//   - For long histories: cells shrink uniformly to fit the container
//     width, no horizontal scrollbar.
// Outside days (activity not yet started / already ended) are hidden
// entirely — Total reads as pure history.
// ---------------------------------------------------------------------------

function TotalTable({
  rows,
  dateCols,
  todayStr,
  off,
  onToggle,
  onOpenInstance,
  tagMap,
}: {
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  off: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenInstance: (i: DayInstance) => void;
  tagMap: TagMap;
}) {
  const padBefore = dateCols.length > 0 ? mondayPad(dateCols[0].date) : 0;
  const totalWithStart = padBefore + dateCols.length;
  const padAfter = (7 - (totalWithStart % 7)) % 7;
  const weekCount = (totalWithStart + padAfter) / 7;
  const stripMaxWidthPx =
    weekCount * TOTAL_CELL_MAX_PX +
    Math.max(0, weekCount - 1) * TOTAL_CELL_GAP_PX;

  const headerLabel =
    dateCols.length > 0
      ? `${formatMonthYearShort(dateCols[0].date)} → today`
      : "";

  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
      <colgroup>
        <col className="w-[8rem]" />
        <col className="w-[4.5rem]" />
        <col />
        <col className="w-[5.5rem]" />
      </colgroup>
      <thead>
        <tr>
          <TH>Activity</TH>
          <TH>Type</TH>
          <TH className="text-left text-[10px] text-zinc-400">{headerLabel}</TH>
          <TH className="text-center">Success</TH>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isOff = off.has(row.activity.id);
          return (
            <tr key={row.activity.id}>
              <NameCell
                row={row}
                isOff={isOff}
                onToggle={onToggle}
                linesMax={2}
              />
              {isOff ? (
                <CollapsedRow span={3} />
              ) : (
                <>
                  <TypeCell row={row} tagMap={tagMap} />
                  <td className="border-b border-zinc-100 px-1 py-0.5 align-top dark:border-zinc-900">
                    <div
                      className="grid"
                      style={{
                        gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))`,
                        gridTemplateRows: "repeat(7, auto)",
                        gridAutoFlow: "column",
                        gap: `${TOTAL_CELL_GAP_PX}px`,
                        maxWidth: `${stripMaxWidthPx}px`,
                      }}
                    >
                      {Array.from({ length: padBefore }, (_, i) => (
                        <div
                          key={`pad-b-${i}`}
                          className={TOTAL_CELL_ASPECT}
                        />
                      ))}
                      {row.cells.map((cell) => (
                        <CellButton
                          key={cell.dateStr}
                          cell={cell}
                          todayStr={todayStr}
                          activityName={row.activity.name}
                          showGlyph={false}
                          aspectClass={TOTAL_CELL_ASPECT}
                          onOpen={onOpenInstance}
                        />
                      ))}
                      {Array.from({ length: padAfter }, (_, i) => (
                        <div
                          key={`pad-a-${i}`}
                          className={TOTAL_CELL_ASPECT}
                        />
                      ))}
                    </div>
                  </td>
                  <SuccessCell row={row} />
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------

function CollapsedRow({ span }: { span: number }) {
  return (
    <td
      colSpan={span}
      className="border-b border-zinc-100 px-2 py-1 text-[10px] italic text-zinc-400 dark:border-zinc-900"
    >
      <span className="opacity-60">Off — toggle on to see history.</span>
    </td>
  );
}

// ---------------------------------------------------------------------------
// CellButton — aspect-square clickable cell. `showGlyph` controls
// whether the ✓ / ✗ / ! / · char renders (drop it when cells get
// smaller than ~14px). `hideOutside` renders "outside" cells as
// invisible (Total mode only).
// ---------------------------------------------------------------------------

function CellButton({
  cell,
  todayStr,
  activityName,
  showGlyph,
  aspectClass,
  onOpen,
}: {
  cell: GridCell;
  todayStr: string;
  activityName: string;
  showGlyph: boolean;
  /** "aspect-square" | "aspect-[2/1]" | etc — the grid cell's shape. */
  aspectClass: string;
  onOpen: (i: DayInstance) => void;
}) {
  // Outside-days (activity hadn't started yet / had already ended)
  // AND not-scheduled days (rhythm doesn't apply this day) both render
  // as empty grid slots. The grid is now a pure "things you were
  // actually on the hook for" surface — no visual noise for off-days.
  if (cell.state === "outside" || cell.state === "not-scheduled") {
    return <div className={aspectClass} />;
  }

  const isToday = cell.dateStr === todayStr;
  let bg = "";
  let glyph: React.ReactNode = "";
  let statusLine: string;

  switch (cell.state) {
    case "completed":
      bg = "bg-emerald-500 text-white hover:bg-emerald-600";
      glyph = "✓";
      statusLine = "Completed";
      break;
    case "missed":
      bg = "bg-red-500 text-white hover:bg-red-600";
      glyph = "✗";
      statusLine = "Missed";
      break;
    case "overdue":
      bg =
        "bg-amber-300 text-amber-900 hover:bg-amber-400 dark:bg-amber-700 dark:text-amber-100";
      glyph = "!";
      statusLine = "Unlabeled";
      break;
    case "scheduled":
      bg =
        "border border-zinc-300 bg-zinc-50 text-zinc-400 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900";
      glyph = "·";
      statusLine = "Scheduled";
      break;
    // "outside" and "not-scheduled" are handled by the early-return
    // guard above CellButton's switch, so they're filtered out of
    // cell.state by the time we get here.
  }

  const baseCls = `group/cell relative ${aspectClass} rounded-[1px] ${bg}${
    showGlyph
      ? " flex items-center justify-center text-[10px] font-medium leading-none"
      : ""
  } transition-colors`;
  const ringCls = isToday ? " ring-1 ring-zinc-900 dark:ring-zinc-50" : "";

  const tooltip = (
    <Tooltip
      statusLine={statusLine}
      activityName={activityName}
      dateStr={cell.dateStr}
    />
  );

  if (!cell.instance) {
    return (
      <div className={baseCls + ringCls} aria-label={statusLine}>
        {showGlyph && glyph}
        {tooltip}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => cell.instance && onOpen(cell.instance)}
      className={baseCls + ringCls + " cursor-pointer"}
      aria-label={`${statusLine} — ${activityName} on ${cell.dateStr}`}
    >
      {showGlyph && glyph}
      {tooltip}
    </button>
  );
}

// ---------------------------------------------------------------------------

function Tooltip({
  statusLine,
  activityName,
  dateStr,
}: {
  statusLine: string;
  activityName: string;
  dateStr: string;
}) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-left text-[11px] font-normal leading-snug text-zinc-50 shadow-lg group-hover/cell:block dark:border-zinc-300 dark:bg-zinc-50 dark:text-zinc-900"
    >
      <span className="block font-semibold">{statusLine}</span>
      <span className="block">{activityName}</span>
      <span className="block text-zinc-300 dark:text-zinc-600">
        {formatDateDmy(dateStr)}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------

function TH({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  // `<th>` cells in the head row are sticky individually (not the
  // <thead> element itself) — sticky on <thead> is hit-or-miss across
  // browsers, but sticky on <th> is reliable. Each th gets a solid bg
  // so scrolled rows don't show through behind the labels.
  return (
    <th
      scope="col"
      className={`sticky ${STICKY_THEAD_TOP} z-10 border-b border-zinc-200 bg-white px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 ${className}`}
    >
      {children}
    </th>
  );
}

// Activity-name cell. `linesMax` caps how many wrapped lines the name
// shows before truncating with "…", per mode:
//   - Week:  1 (cells block is a single row of cells; no wrapping)
//   - Month: 3 (cells block is multi-row but cells are short
//             rectangles → ~100px tall; 3 name lines fit comfortably)
//   - Total: 2 (cells block can shrink down to ~20-30px for power
//             users with hundreds of weeks; 2 lines avoids the name
//             pushing the row taller than the heatmap itself)
function NameCell({
  row,
  isOff,
  onToggle,
  linesMax,
}: {
  row: GridRow;
  isOff: boolean;
  onToggle: (id: string) => void;
  linesMax: 1 | 2 | 3;
}) {
  const clampCls =
    linesMax === 1
      ? "line-clamp-1"
      : linesMax === 2
        ? "line-clamp-2"
        : "line-clamp-3";
  return (
    <th
      scope="row"
      className="border-b border-zinc-100 px-2 py-0.5 text-left align-top text-sm font-medium text-zinc-800 dark:border-zinc-900 dark:text-zinc-200"
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          {/* No `block` here — that overrides line-clamp's
              `display: -webkit-box` and prevents the clamp from
              taking effect, which is what was letting long unbroken
              names like "testtttttttt..." spill past the line limit.
              `break-all` (not `break-words`) is required so long
              run-on words wrap at character boundaries; otherwise
              they'd overflow horizontally and line-clamp wouldn't
              save us. */}
          <span
            className={`break-all font-medium leading-tight ${clampCls}`}
            title={row.activity.name}
          >
            {row.activity.name}
          </span>
          {row.unlabeled > 0 && <UnlabeledBadge count={row.unlabeled} />}
        </div>
        <SlideToggle isOff={isOff} onClick={() => onToggle(row.activity.id)} />
      </div>
    </th>
  );
}

function TypeCell({ row, tagMap }: { row: GridRow; tagMap: TagMap }) {
  // Rhythm category on top; if the activity has tags, a "Tags" link
  // appears underneath that opens a small popover with the chips. The
  // popover sits next to the link via group-hover so users don't need
  // an extra click. (Mobile users can long-press for the same effect
  // via the native :hover fallback.)
  return (
    <td className="border-b border-zinc-100 px-2 py-0.5 align-top text-left text-xs text-zinc-500 dark:border-zinc-900">
      <div>{row.rhythmCategory}</div>
      {row.activity.tags.length > 0 && (
        <div className="group/tags relative inline-block">
          <span className="cursor-pointer text-[10px] text-blue-600 underline-offset-2 hover:underline dark:text-blue-400">
            Tags
          </span>
          {/* Popover */}
          <span
            role="tooltip"
            className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden min-w-max max-w-[14rem] rounded-md border border-zinc-200 bg-white p-2 shadow-md group-hover/tags:block dark:border-zinc-700 dark:bg-zinc-900"
          >
            <TagChipList
              names={row.activity.tags}
              tags={tagMap}
              size="xs"
            />
          </span>
        </div>
      )}
    </td>
  );
}

function SuccessCell({ row }: { row: GridRow }) {
  // Two stacked lines: X/Y | Z% on top, streak below.
  const streakColorCls =
    row.streak > 0
      ? "text-orange-500 dark:text-orange-400"
      : "text-zinc-400";
  return (
    <td
      className="border-b border-zinc-100 px-2 py-0.5 align-top text-center text-xs tabular-nums dark:border-zinc-900"
    >
      <div className={pctClass(row.pct)}>
        {row.pct === null ? (
          "—"
        ) : (
          <span>
            {row.done}/{row.onTheHook} | {row.pct}%
          </span>
        )}
      </div>
      <div className={`${streakColorCls} text-[11px]`}>
        🔥{row.streak}
      </div>
    </td>
  );
}

function UnlabeledBadge({ count }: { count: number }) {
  return (
    <span
      title={`${count} past-due occurrences still need a verdict (mark complete or missed)`}
      className="mt-1 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

// ---------------------------------------------------------------------------

function SlideToggle({
  isOff,
  onClick,
}: {
  isOff: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="switch"
      aria-checked={!isOff}
      title={isOff ? "Show this row" : "Hide this row"}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
        isOff
          ? "bg-zinc-300 dark:bg-zinc-700"
          : "bg-emerald-500 dark:bg-emerald-600"
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
          isOff ? "translate-x-0.5" : "translate-x-3.5"
        }`}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------

function SinglesBanner({
  done,
  total,
  rangeLabel,
  singles,
  onOpenInstance,
}: {
  done: number;
  total: number;
  rangeLabel: string;
  singles: DayInstance[];
  onOpenInstance: (i: DayInstance) => void;
}) {
  // Zero singles in the range → static "nothing here" banner, no
  // expand affordance.
  if (total === 0 && done === 0) {
    return (
      <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        No one-time events {rangeLabel}.
      </p>
    );
  }

  // Expandable via native <details>. The summary keeps the original
  // "X/Y" sentence; opening it reveals one clickable banner per
  // single-event instance. Each banner opens the same ActivityModal a
  // normal Day-view row opens — so the user can mark complete /
  // missed / edit / add notes / etc. straight from the grid.
  return (
    <details className="rounded-md border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="cursor-pointer list-none px-3 py-2 text-center text-xs text-zinc-700 dark:text-zinc-300">
        You have also completed{" "}
        <strong className="tabular-nums">
          {done}/{total}
        </strong>{" "}
        one-time events {rangeLabel}.
        <span className="ml-2 text-[10px] text-zinc-400">
          (click to expand)
        </span>
      </summary>
      <ul className="flex flex-col gap-1 border-t border-zinc-200 px-2 py-2 dark:border-zinc-800">
        {singles.map((inst) => (
          <li key={inst.id}>
            <SinglesRow inst={inst} onOpen={onOpenInstance} />
          </li>
        ))}
      </ul>
    </details>
  );
}

function SinglesRow({
  inst,
  onOpen,
}: {
  inst: DayInstance;
  onOpen: (i: DayInstance) => void;
}) {
  // One row per one-time instance. Status dot on the left mirrors the
  // grid's cell colors so the user can see at a glance which singles
  // are done / missed / unlabeled / still upcoming.
  const a = inst.activity;
  const isCompleted = inst.completionCount > 0;

  let dotCls: string;
  let label: string;
  if (isCompleted) {
    dotCls = "bg-emerald-500";
    label = "Completed";
  } else {
    // Pending. Whether it's "missed/unlabeled/scheduled" depends on
    // the scheduled date vs today — easier to just say "Pending" here
    // and let the modal show the full picture.
    dotCls = "bg-zinc-300 dark:bg-zinc-700";
    label = "Pending";
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(inst)}
      title="Click to open — mark complete / missed / edit"
      className="flex w-full min-w-0 items-start gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-left text-xs transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
    >
      <span
        aria-hidden
        title={label}
        className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${dotCls}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-zinc-800 dark:text-zinc-200">
          {a.name}
        </span>
        <span className="block truncate text-[11px] text-zinc-500">
          {summarizeRhythm(a.rhythm, a.scheduled_times)} ·{" "}
          {formatDateDmy(inst.scheduled_for)}
        </span>
        {a.notes && (
          <span className="block truncate text-[11px] text-zinc-500">
            {a.notes}
          </span>
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------

function GridLegend() {
  const items: Array<{ label: string; swatch: string }> = [
    { label: "Done", swatch: "bg-emerald-500" },
    { label: "Missed", swatch: "bg-red-500" },
    { label: "Unlabeled", swatch: "bg-amber-300 dark:bg-amber-700" },
    {
      label: "Scheduled",
      swatch:
        "border border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900",
    },
  ];
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1">
          <span
            aria-hidden
            className={`inline-block h-3 w-3 rounded ${it.swatch}`}
          />
          {it.label}
        </span>
      ))}
    </p>
  );
}

// ---------------------------------------------------------------------------

function pctClass(pct: number | null): string {
  if (pct === null) return "text-zinc-400";
  if (pct >= 80) return "font-semibold text-emerald-700 dark:text-emerald-300";
  if (pct >= 50) return "text-amber-700 dark:text-amber-300";
  return "text-red-700 dark:text-red-300";
}

function mondayPad(date: Date): number {
  const day = date.getDay();
  return (day + 6) % 7;
}

function formatMonthYearShort(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function formatDateDmy(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const month = date.toLocaleDateString(undefined, { month: "short" });
  const dd = String(d).padStart(2, "0");
  return `${dd} ${month} ${y}`;
}

// ---------------------------------------------------------------------------
// GridToolbar — small client-side toolbar above the grid table with:
//   1. A Sort dropdown (alphabetical, most done, streak, success %).
//   2. A Tag-filter popover (checkbox per tag + "Select all", default
//      everything visible). Filters use OR semantics — an activity
//      shows if ANY of its tags is still checked.
//
// Toolbar state lives in GridTable (parent); this component is purely
// presentational so the toolbar's choices can flow through to the
// row filter / sort logic that runs in the parent's useMemo.
// ---------------------------------------------------------------------------

const SORT_OPTIONS: ReadonlyArray<{ value: GridSortKey; label: string }> = [
  { value: "alpha", label: "Alphabetical (A→Z)" },
  { value: "done-desc", label: "Most done (in period)" },
  { value: "streak-desc", label: "Streak (high → low)" },
  { value: "pct-desc", label: "Success % (high → low)" },
  { value: "pct-asc", label: "Success % (low → high)" },
];

function GridToolbar({
  sortKey,
  onSortChange,
  tagNames,
  hiddenTags,
  onToggleTag,
  onSelectAll,
  tagMap,
}: {
  sortKey: GridSortKey;
  onSortChange: (k: GridSortKey) => void;
  /** Distinct tag names across the visible row set, sorted A→Z. */
  tagNames: string[];
  /** The set of tag names the user has unchecked (= hidden). */
  hiddenTags: ReadonlySet<string>;
  onToggleTag: (name: string) => void;
  onSelectAll: () => void;
  tagMap: TagMap;
}) {
  // Number of tags the user has actively excluded — surfaces in the
  // filter button so they can see at a glance that a filter is on.
  // The "__none__" pseudo-tag (for tagless activities) counts too.
  const hiddenCount = hiddenTags.size;
  const allOn = hiddenCount === 0;
  const noTagsHidden = hiddenTags.has("__none__");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1 text-xs text-zinc-500">
        Sort:
        <select
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as GridSortKey)}
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {/* Tag filter as a <details> popover so it stays open when the
          user clicks a checkbox inside (vs a hover-popover which would
          dismiss). Closes on outside-click thanks to the natural
          <summary> toggle behavior. */}
      <details className="relative">
        <summary
          className={`cursor-pointer list-none rounded border px-2 py-1 text-xs font-medium ${
            allOn
              ? "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
              : "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
          }`}
        >
          Tags: {allOn ? "All" : `${tagNames.length + 1 - hiddenCount} of ${tagNames.length + 1}`}
        </summary>
        <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-zinc-200 bg-white p-2 shadow-md dark:border-zinc-700 dark:bg-zinc-900">
          <button
            type="button"
            onClick={onSelectAll}
            className="mb-1 w-full rounded border border-zinc-300 bg-zinc-50 px-2 py-1 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            ↺ Select all
          </button>
          <ul className="flex flex-col gap-0.5">
            {tagNames.map((name) => {
              const hidden = hiddenTags.has(name);
              const color = tagMap[name]?.color ?? "gray";
              return (
                <li key={name}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800">
                    <input
                      type="checkbox"
                      checked={!hidden}
                      onChange={() => onToggleTag(name)}
                    />
                    <span
                      aria-hidden
                      className={`inline-block h-2 w-2 rounded-full ${tagDotClasses(
                        color
                      )}`}
                    />
                    <span className="flex-1 truncate">{name}</span>
                  </label>
                </li>
              );
            })}
            {/* Pseudo-entry for activities with no tags at all. */}
            <li>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs italic text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <input
                  type="checkbox"
                  checked={!noTagsHidden}
                  onChange={() => onToggleTag("__none__")}
                />
                <span className="flex-1">(no tags)</span>
              </label>
            </li>
          </ul>
        </div>
      </details>
    </div>
  );
}
