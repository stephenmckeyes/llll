"use client";

// ---------------------------------------------------------------------------
// GridTable — the actual table rendered by the Grid (habit-tracker) view.
//
// Layout per mode:
//   - Week:  one horizontal row of 7 normal-size cells (glyphs visible,
//            comfortable hover targets).
//   - Month: a 7-ROW column-major mini-heatmap. Each column = a calendar
//            week (Mon..Sun top to bottom), columns flow left→right
//            chronologically. Cells are tiny (no glyphs, color only).
//   - Total: same shape as Month, just stretches across the full
//            range from the earliest activity start to today.
//            "Not active" days hide entirely in Total (per spec) so
//            the heatmap is pure history.
//
// Per-row visibility toggle:
//   - A slide switch replaces the old "✕" hide button. Off collapses
//     the row to just [name + toggle] (cells / type / success columns
//     blank out) — the row STAYS in position so the layout doesn't
//     jump. No separate hidden footer anymore.
//   - Off state persists in localStorage per user.
//
// Cell click — always opens the ActivityModal (no drill-down).
// Hover — custom 3-line tooltip: status / activity name / "DD Mon YYYY".
// ---------------------------------------------------------------------------

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import { ActivityModal } from "./activity-modal";
import type { DayInstance } from "./day-list";

export type GridCellState =
  | "completed"
  | "missed"
  | "overdue" // internal name; user-facing wording is "Unlabeled"
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
      ) : (
        <HeatmapTable
          mode={mode}
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
// Per-user localStorage-backed off-set (rows that are toggled to "off").
//
// Same key the previous "hidden" set used — the data shape is the same
// (a Set of activity IDs), only the visual treatment changed (collapse
// in place rather than hide entirely).
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
// WeekTable — 7 cells per activity in a single row. Normal-size cells
// with glyphs, since there's plenty of room.
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
            <div className="grid grid-cols-7 gap-px">
              {dateCols.map((c) => (
                <div
                  key={c.dateStr}
                  className={`text-center text-[10px] ${
                    c.dateStr === todayStr
                      ? "font-semibold text-zinc-900 dark:text-zinc-50"
                      : "text-zinc-500"
                  }`}
                >
                  <div className="uppercase tracking-wide">
                    {c.date.toLocaleDateString(undefined, { weekday: "short" })}
                  </div>
                  <div className="text-sm">{c.date.getDate()}</div>
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
              <NameCell row={row} isOff={isOff} onToggle={onToggle} />
              {isOff ? (
                <CollapsedRow span={3} />
              ) : (
                <>
                  <TypeCell row={row} />
                  <td className="border-b border-zinc-100 px-1 py-1.5 dark:border-zinc-900">
                    <div className="grid grid-cols-7 gap-px">
                      {row.cells.map((cell) => (
                        <CellButton
                          key={cell.dateStr}
                          cell={cell}
                          todayStr={todayStr}
                          activityName={row.activity.name}
                          compact={false}
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
// HeatmapTable — Month + Total. 7-row column-major mini-heatmap per
// activity. Columns are weeks (each column flows Mon→Sun top to bottom).
//
// Cell size is FIXED (tiny) per spec, with the strip allowed to
// horizontal-scroll if the range is long. The activity name + type +
// success columns stay put.
//
// In Total mode, "outside" (activity not yet started / already ended)
// cells render as nothing — per spec the Total heatmap is pure history
// without the diagonal-hatch placeholder.
// ---------------------------------------------------------------------------

function HeatmapTable({
  mode,
  rows,
  dateCols,
  todayStr,
  off,
  onToggle,
  onOpenInstance,
}: {
  mode: "month" | "total";
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  off: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onOpenInstance: (i: DayInstance) => void;
}) {
  // Align the first column with Monday by padding the start. Trailing
  // padding fills the last week to keep the grid rectangular.
  const padBefore = dateCols.length > 0 ? mondayPad(dateCols[0].date) : 0;
  const totalWithStart = padBefore + dateCols.length;
  const padAfter = (7 - (totalWithStart % 7)) % 7;
  const weekCount = (totalWithStart + padAfter) / 7;

  const cellPx = 7; // tiny square cells, per spec
  const gapPx = 1;
  const stripWidthPx = weekCount * cellPx + (weekCount - 1) * gapPx;

  const headerLabel =
    mode === "total"
      ? dateCols.length > 0
        ? `${formatMonthYearShort(dateCols[0].date)} → today`
        : ""
      : ""; // Month header is implicit from the page-level nav label.

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
              <NameCell row={row} isOff={isOff} onToggle={onToggle} />
              {isOff ? (
                <CollapsedRow span={3} />
              ) : (
                <>
                  <TypeCell row={row} />
                  <td className="border-b border-zinc-100 px-1 py-1.5 align-top dark:border-zinc-900">
                    {/* The heatmap is allowed to scroll horizontally
                        within its own cell when the range is huge — the
                        rest of the row stays put. */}
                    <div className="overflow-x-auto">
                      <div
                        className="grid"
                        style={{
                          gridTemplateRows: `repeat(7, ${cellPx}px)`,
                          gridTemplateColumns: `repeat(${weekCount}, ${cellPx}px)`,
                          gridAutoFlow: "column",
                          gap: `${gapPx}px`,
                          width: `${stripWidthPx}px`,
                        }}
                      >
                        {Array.from({ length: padBefore }, (_, i) => (
                          <div key={`pad-b-${i}`} />
                        ))}
                        {row.cells.map((cell) => (
                          <CellButton
                            key={cell.dateStr}
                            cell={cell}
                            todayStr={todayStr}
                            activityName={row.activity.name}
                            compact={true}
                            hideOutside={mode === "total"}
                            onOpen={onOpenInstance}
                          />
                        ))}
                        {Array.from({ length: padAfter }, (_, i) => (
                          <div key={`pad-a-${i}`} />
                        ))}
                      </div>
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
  // Empty cells maintaining row position when the activity is toggled
  // off. Single line of vertical padding so the row stays "thin" but
  // still visible enough to find its toggle.
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
// CellButton — clickable square (or plain div if not tied to an
// instance). Opens the modal in any mode.
//
// `compact` mode strips the glyph and tightens leading so cells can be
// as small as ~6-8px and still look like deliberate squares.
//
// `hideOutside` (used only in Total) renders "outside" cells as fully
// blank — no hatch, no border. So a Total heatmap looks like clean
// history with no clutter for days the activity wasn't even active.
// ---------------------------------------------------------------------------

function CellButton({
  cell,
  todayStr,
  activityName,
  compact,
  hideOutside,
  onOpen,
}: {
  cell: GridCell;
  todayStr: string;
  activityName: string;
  compact: boolean;
  hideOutside: boolean;
  onOpen: (i: DayInstance) => void;
}) {
  if (hideOutside && cell.state === "outside") {
    return <div />;
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
      bg = "text-zinc-300 dark:text-zinc-700";
      statusLine = "Not active";
      style = {
        backgroundImage:
          "repeating-linear-gradient(45deg, rgb(228 228 231 / 0.6) 0 2px, transparent 2px 6px)",
      };
      break;
  }

  // Compact mode: drop the glyph (cells are too small to render it
  // anyway) and use a square sized by parent grid. Non-compact (Week):
  // larger square with the glyph visible.
  const sizingCls = compact
    ? "h-full w-full"
    : "flex aspect-square items-center justify-center text-[10px] font-medium leading-none";
  const baseCls = `group/cell relative rounded-[1px] ${sizingCls} transition-colors ${bg}`;
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
        {!compact && glyph}
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
      {!compact && glyph}
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
  // 3-line custom popover. Native title attr can't render multiline
  // reliably across browsers.
  // pointer-events-none so the tooltip never eats the cell's click.
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

// Activity-name cell — wraps text (up to ~3 lines per row to fill the
// heatmap row height) before line-clamping. Hosts the slide toggle on
// the right.
function NameCell({
  row,
  isOff,
  onToggle,
}: {
  row: GridRow;
  isOff: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <th
      scope="row"
      className="border-b border-zinc-100 px-2 py-1.5 text-left align-top text-xs font-medium text-zinc-800 dark:border-zinc-900 dark:text-zinc-200"
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          {/* line-clamp-3 lets the name wrap to up to 3 lines before
              showing "...". Three lines pairs naturally with the
              ~48–56px heatmap row height (Month/Total). For Week, the
              clamp just means very long names truncate at 3 lines. */}
          <span
            className="block break-words font-medium leading-tight line-clamp-3"
            title={row.activity.name}
          >
            {row.activity.name}
          </span>
          {row.unlabeled > 0 && (
            <UnlabeledBadge count={row.unlabeled} />
          )}
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
// SlideToggle — iOS-style on/off switch. ON = full row visible
// (default), OFF = row collapsed in place.
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
  const items: Array<{ label: string; swatch: string; hatch?: boolean }> = [
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
            style={
              it.hatch
                ? {
                    backgroundImage:
                      "repeating-linear-gradient(45deg, rgb(228 228 231 / 0.6) 0 2px, transparent 2px 6px)",
                  }
                : undefined
            }
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
  // JS getDay: Sun=0..Sat=6. We want Monday-start: Mon=0..Sun=6.
  const day = date.getDay();
  return (day + 6) % 7;
}

function formatMonthYearShort(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

// "17 May 2026" / "04 Apr 2028" — day-month-year per user spec.
// Always two-digit day.
function formatDateDmy(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const month = date.toLocaleDateString(undefined, { month: "short" });
  const dd = String(d).padStart(2, "0");
  return `${dd} ${month} ${y}`;
}
