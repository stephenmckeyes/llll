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
  useEffect,
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

/**
 * Sort state — driven by clicking the table's column headers (no
 * dropdown). Each column cycles through its own set of "stages" and
 * resets to default after the last stage.
 *
 *   activity: 1 = A→Z,     2 = Z→A
 *   days:     1 = most,    2 = least  (sums per row over the period)
 *   type:     1..N = each distinct rhythm category goes to the top,
 *             in alphabetical order. N = number of distinct categories
 *             in the current row set.
 *   success:  1 = success high, 2 = success low,
 *             3 = streak high,  4 = streak low.
 *
 * Right-clicking a header opens a menu listing every stage explicitly
 * for users who'd rather pick than cycle. The menu's "Default" entry
 * clears the sort.
 */
export type GridSortColumn = "activity" | "days" | "type" | "success";
export type SortState = { column: GridSortColumn; stage: number } | null;

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

// Sticky-thead offset. ViewSwitcher (top-0, ~80px tall incl. py-2)
// + Navigator (top-[5rem], ~72px tall) stack at the top of the
// viewport. The grid's thead pins just below them at ~152px. If
// either of those layouts changes height, adjust this offset to
// match.
const STICKY_THEAD_TOP = "top-[9.5rem]";

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

  // ---- Click-to-sort state ----------------------------------------------
  const [sort, setSort] = useState<SortState>(null);
  // Right-click context menu — coordinates + which column requested it.
  // Closed by clicking outside (window-level listener inside the menu
  // component itself).
  const [contextMenu, setContextMenu] = useState<{
    column: GridSortColumn;
    x: number;
    y: number;
  } | null>(null);

  // Distinct rhythm categories in the visible row set, alphabetically
  // sorted. Drives both the cycle length for the Type column and the
  // labels shown in its right-click menu.
  const typeStages = useMemo(
    () => Array.from(new Set(rows.map((r) => r.rhythmCategory))).sort(),
    [rows]
  );

  function sortMax(col: GridSortColumn): number {
    switch (col) {
      case "activity":
        return 2;
      case "days":
        return 2;
      case "type":
        return Math.max(1, typeStages.length); // at least 1 so cycling doesn't no-op
      case "success":
        return 4;
    }
  }

  function cycleSort(column: GridSortColumn) {
    setSort((prev) => {
      const max = sortMax(column);
      if (!prev || prev.column !== column) {
        return { column, stage: 1 };
      }
      const next = prev.stage + 1;
      if (next > max) return null; // back to default
      return { column, stage: next };
    });
  }

  function setSortDirect(column: GridSortColumn, stage: number | null) {
    if (stage === null || stage === 0) setSort(null);
    else setSort({ column, stage });
    setContextMenu(null);
  }

  function openContextMenu(column: GridSortColumn, e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ column, x: e.clientX, y: e.clientY });
  }

  // ---- Apply filter (filtering happens upstream in GridSection now;
  // GridTable just receives the already-filtered rows via `rows`) AND
  // sort. -----------------------------------------------------------------
  const visibleRows = useMemo(() => {
    if (!sort) return rows;
    const arr = [...rows];
    if (sort.column === "activity") {
      arr.sort((a, b) => a.activity.name.localeCompare(b.activity.name));
      if (sort.stage === 2) arr.reverse();
    } else if (sort.column === "days") {
      arr.sort((a, b) => b.done - a.done);
      if (sort.stage === 2) arr.reverse();
    } else if (sort.column === "type") {
      const target = typeStages[sort.stage - 1];
      arr.sort((a, b) => {
        const aMatch = a.rhythmCategory === target;
        const bMatch = b.rhythmCategory === target;
        if (aMatch !== bMatch) return aMatch ? -1 : 1;
        return a.activity.name.localeCompare(b.activity.name);
      });
    } else if (sort.column === "success") {
      switch (sort.stage) {
        case 1:
          arr.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
          break;
        case 2:
          arr.sort(
            (a, b) =>
              (a.pct ?? Number.POSITIVE_INFINITY) -
              (b.pct ?? Number.POSITIVE_INFINITY)
          );
          break;
        case 3:
          arr.sort((a, b) => b.streak - a.streak);
          break;
        case 4:
          arr.sort((a, b) => a.streak - b.streak);
          break;
      }
    }
    return arr;
  }, [rows, sort, typeStages]);

  const headerControls = {
    sort,
    cycleSort,
    onContextMenu: openContextMenu,
  };

  return (
    <>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          No rhythmic activities match the current view. Adjust the tag
          filter above, or add a new activity.
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
          headerControls={headerControls}
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
          headerControls={headerControls}
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
          headerControls={headerControls}
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

      {contextMenu && (
        <SortContextMenu
          state={contextMenu}
          typeStages={typeStages}
          onPick={setSortDirect}
          onClose={() => setContextMenu(null)}
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
  headerControls,
}: {
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  off: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenInstance: (i: DayInstance) => void;
  tagMap: TagMap;
  /** Sort state + handlers wired into the column headers. Same object
   *  passed to every table renderer; the table's headers consume it. */
  headerControls: {
    sort: SortState;
    cycleSort: (column: GridSortColumn) => void;
    onContextMenu: (column: GridSortColumn, e: React.MouseEvent) => void;
  };
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
          <SortableTH column="activity" controls={headerControls}>
            Activity
          </SortableTH>
          <SortableTH column="type" controls={headerControls}>
            Type
          </SortableTH>
          <SortableTH column="days" controls={headerControls}>
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
          </SortableTH>
          <SortableTH
            column="success"
            controls={headerControls}
            className="text-center"
          >
            Success
          </SortableTH>
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
  headerControls,
}: {
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  off: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenInstance: (i: DayInstance) => void;
  tagMap: TagMap;
  /** Sort state + handlers wired into the column headers. Same object
   *  passed to every table renderer; the table's headers consume it. */
  headerControls: {
    sort: SortState;
    cycleSort: (column: GridSortColumn) => void;
    onContextMenu: (column: GridSortColumn, e: React.MouseEvent) => void;
  };
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
          <SortableTH column="activity" controls={headerControls}>
            Activity
          </SortableTH>
          <SortableTH column="type" controls={headerControls}>
            Type
          </SortableTH>
          <SortableTH column="days" controls={headerControls}>
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
          </SortableTH>
          <SortableTH
            column="success"
            controls={headerControls}
            className="text-center"
          >
            Success
          </SortableTH>
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
  headerControls,
}: {
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  off: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenInstance: (i: DayInstance) => void;
  tagMap: TagMap;
  /** Sort state + handlers wired into the column headers. Same object
   *  passed to every table renderer; the table's headers consume it. */
  headerControls: {
    sort: SortState;
    cycleSort: (column: GridSortColumn) => void;
    onContextMenu: (column: GridSortColumn, e: React.MouseEvent) => void;
  };
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
          <SortableTH column="activity" controls={headerControls}>
            Activity
          </SortableTH>
          <SortableTH column="type" controls={headerControls}>
            Type
          </SortableTH>
          <SortableTH
            column="days"
            controls={headerControls}
            className="text-left text-[10px] text-zinc-400"
          >
            {headerLabel}
          </SortableTH>
          <SortableTH
            column="success"
            controls={headerControls}
            className="text-center"
          >
            Success
          </SortableTH>
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
// SortableTH — column header that wires a left-click → cycleSort and a
// right-click → context menu to the parent's sort state. Shows a small
// arrow indicator next to the label when this column is the active
// sort.
// ---------------------------------------------------------------------------

function SortableTH({
  column,
  controls,
  className = "",
  children,
}: {
  column: GridSortColumn;
  controls: {
    sort: SortState;
    cycleSort: (column: GridSortColumn) => void;
    onContextMenu: (column: GridSortColumn, e: React.MouseEvent) => void;
  };
  className?: string;
  children: React.ReactNode;
}) {
  const isActive = controls.sort?.column === column;
  // Tiny indicator suffix. Direction depends on the stage — we display
  // ↑ for stage 1 (first-direction) and ↓ for any later stage. The
  // exact semantics differ per column (alpha vs counts vs success
  // metric) but visually "↑/↓ = something is sorted" is enough.
  const indicator = !isActive
    ? null
    : controls.sort!.stage === 1
      ? "↑"
      : "↓";
  // IMPORTANT: do NOT wrap `children` in an `inline-flex` container.
  // The Week / Month thead day-labels are a `grid grid-cols-7` that
  // MUST fill the full TH width so each label aligns with the
  // corresponding day-cell column below. Wrapping it in inline-flex
  // collapses the grid to its content width and breaks alignment.
  // Indicator floats absolutely in the top-right corner so it
  // doesn't take part in the children's layout.
  return (
    <th
      scope="col"
      onClick={() => controls.cycleSort(column)}
      onContextMenu={(e) => controls.onContextMenu(column, e)}
      title="Click to sort · right-click for options"
      className={`sticky ${STICKY_THEAD_TOP} relative z-10 cursor-pointer select-none border-b border-zinc-200 bg-white px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900 ${className}`}
    >
      {children}
      {indicator && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-1 top-1 text-zinc-700 dark:text-zinc-200"
        >
          {indicator}
        </span>
      )}
    </th>
  );
}

// ---------------------------------------------------------------------------
// SortContextMenu — small popover shown on right-click of a SortableTH.
// Lists every named stage for the column so the user can pick directly
// rather than cycle. "Default" clears the sort.
// ---------------------------------------------------------------------------

function SortContextMenu({
  state,
  typeStages,
  onPick,
  onClose,
}: {
  state: { column: GridSortColumn; x: number; y: number };
  typeStages: string[];
  onPick: (column: GridSortColumn, stage: number | null) => void;
  onClose: () => void;
}) {
  // Close on outside click — install a window listener while open.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-sort-context-menu]")) onClose();
    };
    // Defer one tick so the same right-click that opened the menu
    // doesn't immediately close it.
    const t = setTimeout(() => {
      window.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Build label list per column.
  let options: Array<{ stage: number | null; label: string }>;
  switch (state.column) {
    case "activity":
      options = [
        { stage: null, label: "Default order" },
        { stage: 1, label: "Activity A → Z" },
        { stage: 2, label: "Activity Z → A" },
      ];
      break;
    case "days":
      options = [
        { stage: null, label: "Default order" },
        { stage: 1, label: "Most done (in period)" },
        { stage: 2, label: "Least done (in period)" },
      ];
      break;
    case "type":
      options = [
        { stage: null, label: "Default order" },
        ...typeStages.map((t, i) => ({
          stage: i + 1,
          label: `${t} first`,
        })),
      ];
      break;
    case "success":
      options = [
        { stage: null, label: "Default order" },
        { stage: 1, label: "Success % (high → low)" },
        { stage: 2, label: "Success % (low → high)" },
        { stage: 3, label: "Streak (high → low)" },
        { stage: 4, label: "Streak (low → high)" },
      ];
      break;
  }

  return (
    <div
      data-sort-context-menu
      role="menu"
      style={{
        position: "fixed",
        // Clamp inside the viewport so the menu never falls off-screen
        // on edge clicks.
        left: Math.min(state.x, window.innerWidth - 220),
        top: Math.min(state.y, window.innerHeight - 280),
      }}
      className="z-50 min-w-[200px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
    >
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          onClick={() => onPick(state.column, o.stage)}
          className="block w-full px-3 py-1.5 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TagFilterPopover — controlled popover for the grid view's tag filter.
// Lifts cleanly into GridSection (above GridTable) so it can sit
// visually inside the GridNavigator row alongside the date controls.
// Closes on outside-click via a window listener; clicking inside the
// panel stays open. Two action buttons: Select all (clears the
// hidden set) and Deselect all (hides all tags including __none__).
// ---------------------------------------------------------------------------

export function TagFilterPopover({
  tagNames,
  hiddenTags,
  tagMap,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: {
  tagNames: string[];
  hiddenTags: ReadonlySet<string>;
  tagMap: TagMap;
  onToggle: (name: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Outside-click + Escape closer. Subscribes only while open so we
  // aren't running a global listener for nothing the rest of the time.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hiddenCount = hiddenTags.size;
  const allOn = hiddenCount === 0;
  const allOff = hiddenCount === tagNames.length + 1;
  const noTagsHidden = hiddenTags.has("__none__");
  const visibleCount = tagNames.length + 1 - hiddenCount;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`shrink-0 cursor-pointer rounded-md border px-2 py-1 text-xs font-medium ${
          allOn
            ? "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
        }`}
      >
        Tags: {allOn ? "All" : `${visibleCount} of ${tagNames.length + 1}`}
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute right-0 top-full z-40 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-zinc-200 bg-white p-2 shadow-md dark:border-zinc-700 dark:bg-zinc-900"
        >
          {/* One toggle button that flips between "Select all" and
              "Deselect all" depending on current state. When everything
              is already visible, the helpful action is to hide everything
              so the user can re-check just the few they want. */}
          <button
            type="button"
            onClick={allOff ? onSelectAll : onDeselectAll}
            className="mb-1 w-full rounded border border-zinc-300 bg-zinc-50 px-2 py-1 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            {allOff ? "↺ Select all" : "✕ Deselect all"}
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
                      onChange={() => onToggle(name)}
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
            <li>
              <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs italic text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <input
                  type="checkbox"
                  checked={!noTagsHidden}
                  onChange={() => onToggle("__none__")}
                />
                <span className="flex-1">(no tags)</span>
              </label>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
