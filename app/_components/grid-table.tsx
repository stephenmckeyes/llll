"use client";

// ---------------------------------------------------------------------------
// GridTable — the actual table rendered by the Grid (habit-tracker) view.
//
// Layout strategy (per-mode):
//   - Week:  one big horizontal row of 7 cells per activity. Plenty of
//            room to make each cell large enough to comfortably hover.
//   - Month: a 7-column mini-month per activity (5–6 rows tall). Same
//            calendar-grid shape the home Month view uses, just
//            per-activity. Cells stay tappable without horizontal
//            scroll.
//   - Total: a 7-ROW heatmap per activity (week-aligned). Each column
//            is a week, so a year's worth of data fits in ~52 columns.
//            For longer histories the columns shrink with the
//            container — at no point do we introduce horizontal scroll.
//
// Cell click — same in every mode:
//   - Opens the same ActivityModal the Day view uses (complete, mark
//     missed, edit, etc.). Per spec, we no longer drill Total→Month
//     →Week — direct access from any heatmap cell is faster.
//
// Hover tooltip:
//   - Custom 3-line tooltip ("status / name / on DD/MM/YYYY"), shown
//     on group-hover. Native title attr can't render multi-line
//     reliably across browsers.
//
// Per-activity hide toggle:
//   - Each row has a small "✕" button hiding that row. Hidden IDs
//     persist in localStorage (`mission-grid-hidden-{userId}`), so
//     the choice survives navigation. A footer chip strip lists the
//     hidden activities for one-click un-hide.
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
  // null when the cell isn't tied to a real instance row. Clicking
  // does nothing in that case.
  instance: DayInstance | null;
};

export type GridRow = {
  activity: {
    id: string;
    name: string;
  };
  /** Human-readable rhythm category, e.g. "Daily", "Multi", "Specific". */
  rhythmCategory: string;
  cells: GridCell[];
  pct: number | null;
  done: number;
  missed: number;
  /** Past-pending instances ("Unlabeled" in UI). */
  unlabeled: number;
  /** On-the-hook count = done + missed + unlabeled. */
  onTheHook: number;
};

export type DateCol = {
  date: Date;
  dateStr: string;
};

export type GridMode = "week" | "month" | "total";

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
  /** Used to namespace localStorage keys per user. */
  userId: string;
}) {
  const [openInstance, setOpenInstance] = useState<DayInstance | null>(null);
  const { hidden, hide, show } = useHiddenActivities(userId);

  const visibleRows = rows.filter((r) => !hidden.has(r.activity.id));
  const hiddenRows = rows.filter((r) => hidden.has(r.activity.id));

  return (
    <>
      {visibleRows.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          {rows.length === 0
            ? "No rhythmic activities active in this period. Add one, or pick a different time window."
            : "Every activity is hidden — restore one from the strip below to see it."}
        </p>
      ) : mode === "total" ? (
        <TotalTable
          rows={visibleRows}
          dateCols={dateCols}
          todayStr={todayStr}
          onOpenInstance={setOpenInstance}
          onHide={hide}
        />
      ) : mode === "month" ? (
        <MonthTable
          rows={visibleRows}
          dateCols={dateCols}
          todayStr={todayStr}
          onOpenInstance={setOpenInstance}
          onHide={hide}
        />
      ) : (
        <WeekTable
          rows={visibleRows}
          dateCols={dateCols}
          todayStr={todayStr}
          onOpenInstance={setOpenInstance}
          onHide={hide}
        />
      )}

      {hiddenRows.length > 0 && (
        <HiddenStrip rows={hiddenRows} onShow={show} />
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
// Per-user localStorage-backed hide set.
//
// Implemented via useSyncExternalStore (the React 19 idiomatic way to
// subscribe to an external data source like localStorage). Server
// snapshot is always empty so SSR renders nothing as hidden; the
// hydrated client picks up the real set after mount. Writes dispatch
// a custom event so same-window subscribers re-snapshot — the native
// `storage` event only fires in OTHER tabs.
// ---------------------------------------------------------------------------

const HIDDEN_CHANGE_EVENT = "mission-grid-hidden-changed";
const EMPTY_HIDDEN: ReadonlySet<string> = new Set();

function useHiddenActivities(userId: string) {
  const key = `mission-grid-hidden:${userId}`;

  // Cache: useSyncExternalStore requires getSnapshot to return a stable
  // reference when the underlying data hasn't changed. We key the cache
  // on the raw JSON string so we only build a new Set when the string
  // actually differs.
  const cacheRef = useRef<{ raw: string | null; set: ReadonlySet<string> }>({
    raw: null,
    set: EMPTY_HIDDEN,
  });

  const subscribe = useCallback((cb: () => void) => {
    if (typeof window === "undefined") return () => {};
    window.addEventListener(HIDDEN_CHANGE_EVENT, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(HIDDEN_CHANGE_EVENT, cb);
      window.removeEventListener("storage", cb);
    };
  }, []);

  const getSnapshot = useCallback((): ReadonlySet<string> => {
    if (typeof window === "undefined") return EMPTY_HIDDEN;
    const raw = window.localStorage.getItem(key);
    if (raw === cacheRef.current.raw) return cacheRef.current.set;
    let set: ReadonlySet<string> = EMPTY_HIDDEN;
    if (raw) {
      try {
        const arr = JSON.parse(raw) as unknown;
        if (Array.isArray(arr)) {
          set = new Set(arr.filter((v): v is string => typeof v === "string"));
        }
      } catch {
        // Corrupt JSON — pretend it's empty.
      }
    }
    cacheRef.current = { raw, set };
    return set;
  }, [key]);

  const hidden = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY_HIDDEN
  );

  function commit(next: Set<string>) {
    try {
      window.localStorage.setItem(key, JSON.stringify(Array.from(next)));
      // Notify same-window subscribers — `storage` only fires for
      // OTHER windows, so this component would miss its own writes
      // without an explicit nudge.
      window.dispatchEvent(new Event(HIDDEN_CHANGE_EVENT));
    } catch {
      // Quota / privacy mode — best-effort.
    }
  }

  function hide(id: string) {
    const next = new Set(hidden);
    next.add(id);
    commit(next);
  }

  function show(id: string) {
    const next = new Set(hidden);
    next.delete(id);
    commit(next);
  }

  return { hidden, hide, show };
}

// ---------------------------------------------------------------------------
// WeekTable — 7 cells per activity, plenty of room per cell.
// ---------------------------------------------------------------------------

function WeekTable({
  rows,
  dateCols,
  todayStr,
  onOpenInstance,
  onHide,
}: {
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  onOpenInstance: (i: DayInstance) => void;
  onHide: (id: string) => void;
}) {
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
      <colgroup>
        <col className="w-[6.5rem]" />
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
        {rows.map((row) => (
          <tr key={row.activity.id}>
            <NameCell row={row} onHide={onHide} />
            <TypeCell row={row} />
            <td className="border-b border-zinc-100 px-1 py-1.5 dark:border-zinc-900">
              <div className="grid grid-cols-7 gap-px">
                {row.cells.map((cell) => (
                  <CellButton
                    key={cell.dateStr}
                    cell={cell}
                    todayStr={todayStr}
                    activityName={row.activity.name}
                    onOpen={onOpenInstance}
                  />
                ))}
              </div>
            </td>
            <SuccessCell row={row} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// MonthTable — 7-column mini-month per activity.
//
// We pad before the first date and after the last to align with
// Mon..Sun columns, so each row inside the grid is a real calendar
// week. Padding cells are blank.
// ---------------------------------------------------------------------------

function MonthTable({
  rows,
  dateCols,
  todayStr,
  onOpenInstance,
  onHide,
}: {
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  onOpenInstance: (i: DayInstance) => void;
  onHide: (id: string) => void;
}) {
  const padBefore = dateCols.length > 0 ? mondayPad(dateCols[0].date) : 0;
  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
      <colgroup>
        <col className="w-[6.5rem]" />
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
        {rows.map((row) => (
          <tr key={row.activity.id}>
            <NameCell row={row} onHide={onHide} />
            <TypeCell row={row} />
            <td className="border-b border-zinc-100 px-1 py-1.5 dark:border-zinc-900">
              <div className="grid grid-cols-7 gap-px">
                {Array.from({ length: padBefore }, (_, i) => (
                  <div key={`pad-${i}`} className="aspect-square" />
                ))}
                {row.cells.map((cell) => (
                  <CellButton
                    key={cell.dateStr}
                    cell={cell}
                    todayStr={todayStr}
                    activityName={row.activity.name}
                    onOpen={onOpenInstance}
                  />
                ))}
              </div>
            </td>
            <SuccessCell row={row} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// TotalTable — 7-row heatmap (column-major), one column per calendar
// week. Cells flow top-to-bottom (Mon..Sun), then left-to-right
// week-by-week. Width shrinks via 1fr columns — no horizontal scroll.
// ---------------------------------------------------------------------------

function TotalTable({
  rows,
  dateCols,
  todayStr,
  onOpenInstance,
  onHide,
}: {
  rows: GridRow[];
  dateCols: DateCol[];
  todayStr: string;
  onOpenInstance: (i: DayInstance) => void;
  onHide: (id: string) => void;
}) {
  // Pad the start of the first week (Mon..) and the end of the last
  // week so the column-major grid stays neatly week-aligned.
  const padBefore = dateCols.length > 0 ? mondayPad(dateCols[0].date) : 0;
  const totalSoFar = padBefore + dateCols.length;
  const padAfter = (7 - (totalSoFar % 7)) % 7;
  const weekCount = (totalSoFar + padAfter) / 7;

  return (
    <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
      <colgroup>
        <col className="w-[6.5rem]" />
        <col className="w-[4.5rem]" />
        <col />
        <col className="w-[5.5rem]" />
      </colgroup>
      <thead>
        <tr>
          <TH>Activity</TH>
          <TH>Type</TH>
          <TH className="text-left text-[10px] text-zinc-400">
            {dateCols.length > 0 ? (
              <span>
                {dateCols[0].date.toLocaleDateString(undefined, {
                  month: "short",
                  year: "numeric",
                })}
                {" → today"}
              </span>
            ) : (
              ""
            )}
          </TH>
          <TH className="text-center">Success</TH>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.activity.id}>
            <NameCell row={row} onHide={onHide} />
            <TypeCell row={row} />
            <td className="border-b border-zinc-100 px-1 py-1.5 dark:border-zinc-900">
              <div
                className="grid gap-px"
                style={{
                  gridTemplateRows: "repeat(7, minmax(0, 1fr))",
                  gridTemplateColumns: `repeat(${weekCount}, minmax(0, 1fr))`,
                  gridAutoFlow: "column",
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
                    onOpen={onOpenInstance}
                  />
                ))}
                {Array.from({ length: padAfter }, (_, i) => (
                  <div key={`pad-a-${i}`} />
                ))}
              </div>
            </td>
            <SuccessCell row={row} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// CellButton — the actual clickable square that opens the modal.
//
// Always renders as a button (or a plain span if there's no instance
// behind it). Three-line custom tooltip on hover, since native title
// attr can't render multi-line text reliably.
// ---------------------------------------------------------------------------

function CellButton({
  cell,
  todayStr,
  activityName,
  onOpen,
}: {
  cell: GridCell;
  todayStr: string;
  activityName: string;
  onOpen: (i: DayInstance) => void;
}) {
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
      bg = "text-zinc-300 dark:text-zinc-700";
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

  const baseCls = `group/cell relative flex aspect-square items-center justify-center rounded text-[10px] font-medium leading-none transition-colors ${bg}`;
  const ringCls = isToday ? " ring-1 ring-zinc-900 dark:ring-zinc-50" : "";

  const tooltip = (
    <Tooltip
      statusLine={statusLine}
      activityName={activityName}
      dateStr={cell.dateStr}
    />
  );

  // Non-clickable: render as a plain div (still gets the hover tooltip
  // so the user sees why it's blank).
  if (!cell.instance) {
    return (
      <div className={baseCls + ringCls} style={style} aria-label={statusLine}>
        {glyph}
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
      {glyph}
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
  // 3 lines per spec: status / name / on DD/MM/YYYY.
  // Custom popover (not native title) so we can render multiple lines
  // reliably across browsers and size it readably.
  const [y, m, d] = dateStr.split("-");
  return (
    <span
      // pointer-events-none so the tooltip never eats the cell's click
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-left text-[11px] font-normal leading-snug text-zinc-50 shadow-lg group-hover/cell:block dark:border-zinc-300 dark:bg-zinc-50 dark:text-zinc-900"
    >
      <span className="block font-semibold">{statusLine}</span>
      <span className="block">{activityName}</span>
      <span className="block text-zinc-300 dark:text-zinc-600">{`on ${d}/${m}/${y}`}</span>
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

// Activity-name cell — shows the (truncated) name, the small unlabeled
// red-circle badge when there are past-due occurrences, and a tiny
// "hide row" button on the right edge.
function NameCell({
  row,
  onHide,
}: {
  row: GridRow;
  onHide: (id: string) => void;
}) {
  return (
    <th
      scope="row"
      className="border-b border-zinc-100 px-2 py-1.5 text-left text-xs font-medium text-zinc-800 dark:border-zinc-900 dark:text-zinc-200"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          className="block min-w-0 flex-1 truncate"
          title={row.activity.name}
        >
          {row.activity.name}
        </span>
        {row.unlabeled > 0 && <UnlabeledBadge count={row.unlabeled} />}
        <button
          type="button"
          onClick={() => onHide(row.activity.id)}
          aria-label={`Hide ${row.activity.name}`}
          title={`Hide ${row.activity.name}`}
          className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          ✕
        </button>
      </span>
    </th>
  );
}

function TypeCell({ row }: { row: GridRow }) {
  return (
    <td className="border-b border-zinc-100 px-2 py-1.5 text-left text-[11px] text-zinc-500 dark:border-zinc-900">
      {row.rhythmCategory}
    </td>
  );
}

// SuccessCell shows "X/Y | Z%" per spec — fraction + percent together,
// both useful at different scales. Color-coded by Z%.
function SuccessCell({ row }: { row: GridRow }) {
  return (
    <td
      className={`border-b border-zinc-100 px-2 py-1.5 text-center text-[11px] tabular-nums dark:border-zinc-900 ${pctClass(
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

// Small red-circle count badge — same visual shape as the Unlabeled
// chip's inner badge in the IncompleteButton, so the two are
// recognizably the same thing.
function UnlabeledBadge({ count }: { count: number }) {
  return (
    <span
      title={`${count} past-due occurrences still need a verdict (mark complete or missed)`}
      className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

// ---------------------------------------------------------------------------

function HiddenStrip({
  rows,
  onShow,
}: {
  rows: GridRow[];
  onShow: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      <span className="uppercase tracking-wide text-[10px] text-zinc-500">
        Hidden ({rows.length}):
      </span>
      {rows.map((r) => (
        <button
          key={r.activity.id}
          type="button"
          onClick={() => onShow(r.activity.id)}
          title="Click to show again"
          className="inline-flex items-center gap-1 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <span className="max-w-[8rem] truncate">{r.activity.name}</span>
          <span aria-hidden className="text-zinc-400">↻</span>
        </button>
      ))}
    </div>
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
    { label: "Not active", swatch: "", hatch: true },
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

// Number of empty cells to insert before the first real cell so a
// Monday-start week-grid lines up. Mon == 0 leading empty cells, Sun
// == 6 leading empty cells.
function mondayPad(date: Date): number {
  const day = date.getDay(); // Sun = 0 .. Sat = 6
  return (day + 6) % 7; // Mon = 0, Sun = 6
}
