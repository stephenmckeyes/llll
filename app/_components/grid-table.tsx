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

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import { ActivityModal } from "./activity-modal";
import type { DayInstance } from "./day-list";

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
  activity: { id: string; name: string };
  rhythmCategory: string;
  cells: GridCell[];
  pct: number | null;
  done: number;
  missed: number;
  unlabeled: number;
  onTheHook: number;
};

export type DateCol = { date: Date; dateStr: string };

export type GridMode = "week" | "month" | "total";

// Cell-size caps per mode (pixels). These are the MAX cell width; the
// actual size is min(cap, container_width / cols), so cells shrink
// when content would overflow.
const WEEK_CELL_MAX_PX = 22;
const MONTH_CELL_MAX_PX = 14;
const TOTAL_CELL_MAX_PX = 12;
const CELL_GAP_PX = 1;

// ---------------------------------------------------------------------------

export function GridTable({
  mode,
  rows,
  dateCols,
  todayStr,
  rangeLabel,
  singlesDone,
  singlesTotal,
  userId,
}: {
  mode: GridMode;
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  rangeLabel: string;
  singlesDone: number;
  singlesTotal: number;
  userId: string;
}) {
  const [openInstance, setOpenInstance] = useState<DayInstance | null>(null);
  const { off, toggle } = useRowOffSet(userId);

  return (
    <>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          No rhythmic activities active in this period. Add one, or pick a
          different time window.
        </p>
      ) : mode === "week" ? (
        <WeekTable
          rows={rows}
          dateCols={dateCols}
          todayStr={todayStr}
          off={off}
          onToggle={toggle}
          onOpenInstance={setOpenInstance}
        />
      ) : mode === "month" ? (
        <MonthTable
          rows={rows}
          dateCols={dateCols}
          todayStr={todayStr}
          off={off}
          onToggle={toggle}
          onOpenInstance={setOpenInstance}
        />
      ) : (
        <TotalTable
          rows={rows}
          dateCols={dateCols}
          todayStr={todayStr}
          off={off}
          onToggle={toggle}
          onOpenInstance={setOpenInstance}
        />
      )}

      <SinglesBanner
        done={singlesDone}
        total={singlesTotal}
        rangeLabel={rangeLabel}
      />

      <GridLegend />

      {openInstance && (
        <ActivityModal
          instance={openInstance}
          todayStr={todayStr}
          onClose={() => setOpenInstance(null)}
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
}: {
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  off: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenInstance: (i: DayInstance) => void;
}) {
  const stripMaxWidthPx = 7 * WEEK_CELL_MAX_PX + 6 * CELL_GAP_PX;

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
            <div
              className="grid grid-cols-7 gap-px"
              style={{ maxWidth: `${stripMaxWidthPx}px` }}
            >
              {dateCols.map((c) => (
                <div
                  key={c.dateStr}
                  className={`text-center text-[9px] leading-tight ${
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
                  <TypeCell row={row} />
                  <td className="border-b border-zinc-100 px-1 py-1 dark:border-zinc-900">
                    <div
                      className="grid grid-cols-7 gap-px"
                      style={{ maxWidth: `${stripMaxWidthPx}px` }}
                    >
                      {row.cells.map((cell) => (
                        <CellButton
                          key={cell.dateStr}
                          cell={cell}
                          todayStr={todayStr}
                          activityName={row.activity.name}
                          showGlyph={true}
                          hideOutside={false}
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
}: {
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  off: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenInstance: (i: DayInstance) => void;
}) {
  const padBefore = dateCols.length > 0 ? mondayPad(dateCols[0].date) : 0;
  const stripMaxWidthPx = 7 * MONTH_CELL_MAX_PX + 6 * CELL_GAP_PX;

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
            <div
              className="grid grid-cols-7 gap-px"
              style={{ maxWidth: `${stripMaxWidthPx}px` }}
            >
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <div
                  key={i}
                  className="text-center text-[9px] font-medium text-zinc-400"
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
                  <TypeCell row={row} />
                  <td className="border-b border-zinc-100 px-1 py-1.5 align-top dark:border-zinc-900">
                    <div
                      className="grid grid-cols-7 gap-px"
                      style={{ maxWidth: `${stripMaxWidthPx}px` }}
                    >
                      {Array.from({ length: padBefore }, (_, i) => (
                        <div
                          key={`pad-${i}`}
                          className="aspect-square"
                        />
                      ))}
                      {row.cells.map((cell) => (
                        <CellButton
                          key={cell.dateStr}
                          cell={cell}
                          todayStr={todayStr}
                          activityName={row.activity.name}
                          showGlyph={false}
                          hideOutside={false}
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
}: {
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  off: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenInstance: (i: DayInstance) => void;
}) {
  const padBefore = dateCols.length > 0 ? mondayPad(dateCols[0].date) : 0;
  const totalWithStart = padBefore + dateCols.length;
  const padAfter = (7 - (totalWithStart % 7)) % 7;
  const weekCount = (totalWithStart + padAfter) / 7;
  const stripMaxWidthPx =
    weekCount * TOTAL_CELL_MAX_PX + Math.max(0, weekCount - 1) * CELL_GAP_PX;

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
                linesMax={3}
              />
              {isOff ? (
                <CollapsedRow span={3} />
              ) : (
                <>
                  <TypeCell row={row} />
                  <td className="border-b border-zinc-100 px-1 py-1.5 align-top dark:border-zinc-900">
                    <div
                      className="grid"
                      style={{
                        gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))`,
                        gridTemplateRows: "repeat(7, auto)",
                        gridAutoFlow: "column",
                        gap: `${CELL_GAP_PX}px`,
                        maxWidth: `${stripMaxWidthPx}px`,
                      }}
                    >
                      {Array.from({ length: padBefore }, (_, i) => (
                        <div
                          key={`pad-b-${i}`}
                          className="aspect-square"
                        />
                      ))}
                      {row.cells.map((cell) => (
                        <CellButton
                          key={cell.dateStr}
                          cell={cell}
                          todayStr={todayStr}
                          activityName={row.activity.name}
                          showGlyph={false}
                          hideOutside={true}
                          onOpen={onOpenInstance}
                        />
                      ))}
                      {Array.from({ length: padAfter }, (_, i) => (
                        <div
                          key={`pad-a-${i}`}
                          className="aspect-square"
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
  hideOutside,
  onOpen,
}: {
  cell: GridCell;
  todayStr: string;
  activityName: string;
  showGlyph: boolean;
  hideOutside: boolean;
  onOpen: (i: DayInstance) => void;
}) {
  if (hideOutside && cell.state === "outside") {
    // Render an empty grid slot so the column-major flow stays aligned.
    return <div className="aspect-square" />;
  }

  const isToday = cell.dateStr === todayStr;
  let bg = "";
  let glyph: React.ReactNode = "";
  let statusLine: string;
  let style: React.CSSProperties | undefined;

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
    case "not-scheduled":
      bg = "bg-zinc-100 dark:bg-zinc-900";
      statusLine = "Not scheduled";
      break;
    case "outside":
      // Used in Month (where hideOutside is false). In Total this path
      // is short-circuited above.
      bg = "text-zinc-300 dark:text-zinc-700";
      statusLine = "Not active";
      style = {
        backgroundImage:
          "repeating-linear-gradient(45deg, rgb(228 228 231 / 0.6) 0 2px, transparent 2px 6px)",
      };
      break;
  }

  const baseCls = `group/cell relative aspect-square rounded-[1px] ${bg}${
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
      <div className={baseCls + ringCls} style={style} aria-label={statusLine}>
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
      style={style}
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
  return (
    <th
      scope="col"
      className={`border-b border-zinc-200 px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-800 ${className}`}
    >
      {children}
    </th>
  );
}

// Activity-name cell. `linesMax` lets each mode decide how many lines
// the name can wrap to before truncating:
//   - Week: 1 (single visual row, no wrapping)
//   - Month/Total: 3 (wrap to fill the heatmap row height)
function NameCell({
  row,
  isOff,
  onToggle,
  linesMax,
}: {
  row: GridRow;
  isOff: boolean;
  onToggle: (id: string) => void;
  linesMax: 1 | 3;
}) {
  const clampCls = linesMax === 1 ? "line-clamp-1" : "line-clamp-3";
  return (
    <th
      scope="row"
      className="border-b border-zinc-100 px-2 py-1.5 text-left align-top text-xs font-medium text-zinc-800 dark:border-zinc-900 dark:text-zinc-200"
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <span
            className={`block break-words font-medium leading-tight ${clampCls}`}
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

function TypeCell({ row }: { row: GridRow }) {
  return (
    <td className="border-b border-zinc-100 px-2 py-1.5 align-top text-left text-[11px] text-zinc-500 dark:border-zinc-900">
      {row.rhythmCategory}
    </td>
  );
}

function SuccessCell({ row }: { row: GridRow }) {
  return (
    <td
      className={`border-b border-zinc-100 px-2 py-1.5 align-top text-center text-[11px] tabular-nums dark:border-zinc-900 ${pctClass(
        row.pct
      )}`}
    >
      {row.pct === null ? (
        "—"
      ) : (
        <span>
          {row.done}/{row.onTheHook} | {row.pct}%
        </span>
      )}
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
}: {
  done: number;
  total: number;
  rangeLabel: string;
}) {
  if (total === 0 && done === 0) {
    return (
      <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        No one-time events {rangeLabel}.
      </p>
    );
  }
  return (
    <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-center text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
      You have also completed{" "}
      <strong className="tabular-nums">
        {done}/{total}
      </strong>{" "}
      one-time events {rangeLabel}.
    </p>
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
