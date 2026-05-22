"use client";

// ---------------------------------------------------------------------------
// FriendView — read-only Total / Calendar / Grid of ONE friend's shared
// rhythms. You can look and copy, never edit (there are no mutation controls
// here at all — the data comes from SECURITY DEFINER RPCs scoped to what the
// friend shared with you).
//
//   - Total    : every shared rhythm, grouped Active / Archived. Template-
//                only shares (progress not shared) and archived shares are
//                labelled and never appear on the calendar/grid.
//   - Calendar : the friend's actual occurrences + completion state, by day.
//   - Grid     : a compact heatmap of the last few weeks.
//
// "Copy to my schedule" is the one action — it creates YOUR own activity
// from the shared template and never touches the friend's.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";

import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import { rhythmCategoryLabel, summarizeRhythm } from "@/lib/domain/rhythm-summary";
import type { TagMap } from "@/lib/domain/tags";

import { TagChipList } from "@/app/_components/tag-chip";

import { CopyShareModal } from "../copy-share-modal";

type ViewKind = "total" | "calendar" | "grid";

// Hard cap on grid columns so a friend with years of shared history doesn't
// blow out the table width. We keep the most recent COLS days of the range.
const GRID_MAX_COLS = 70;

export function FriendView({
  friendName,
  shares,
  instances,
  todayStr,
  tagMap,
}: {
  friendName: string;
  shares: SharedActivity[];
  instances: SharedInstance[];
  todayStr: string;
  tagMap: TagMap;
}) {
  const [view, setView] = useState<ViewKind>("total");
  const [copying, setCopying] = useState<SharedActivity | null>(null);

  if (shares.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
        {friendName} hasn&rsquo;t shared anything with you yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Read-only sub-tabs — Total / Calendar / Grid. */}
      <nav className="flex gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
        {(
          [
            ["total", "Total"],
            ["calendar", "Calendar"],
            ["grid", "Grid"],
          ] as const
        ).map(([val, label]) => (
          <button
            key={val}
            type="button"
            onClick={() => setView(val)}
            className={`flex flex-1 items-center justify-center rounded px-3 py-1 text-center text-sm font-semibold transition-colors ${
              view === val
                ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === "total" && (
        <TotalReadOnly
          shares={shares}
          tagMap={tagMap}
          onCopy={(s) => setCopying(s)}
        />
      )}
      {view === "calendar" && (
        <CalendarReadOnly
          shares={shares}
          instances={instances}
          todayStr={todayStr}
          friendName={friendName}
        />
      )}
      {view === "grid" && (
        <GridReadOnly
          shares={shares}
          instances={instances}
          todayStr={todayStr}
          friendName={friendName}
        />
      )}

      {copying && (
        <CopyShareModal
          shared={copying}
          tagMap={tagMap}
          onClose={() => setCopying(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Total — grouped Active / Archived, with a Copy action on each card.
// ---------------------------------------------------------------------------

type GroupBy = "status" | "tag" | "rhythm";
type StatusFilter = "all" | "active" | "archived";
type ShareGroup = { key: string; label: string; items: SharedActivity[] };

function TotalReadOnly({
  shares,
  tagMap,
  onCopy,
}: {
  shares: SharedActivity[];
  tagMap: TagMap;
  onCopy: (s: SharedActivity) => void;
}) {
  // Mirrors the individual Total View: group by Status / Tag / Rhythm, with
  // an Active / Archived filter. Defaults to Tag + Active to match the
  // dashboard's default.
  const [groupBy, setGroupBy] = useState<GroupBy>("tag");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  const filtered = useMemo(() => {
    if (statusFilter === "active")
      return shares.filter((s) => s.archivedAt === null);
    if (statusFilter === "archived")
      return shares.filter((s) => s.archivedAt !== null);
    return shares;
  }, [shares, statusFilter]);

  const groups = useMemo(
    () => buildShareGroups(filtered, groupBy),
    [filtered, groupBy]
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
        <ControlRow label="Group by">
          <Segmented
            options={[
              ["status", "Status"],
              ["tag", "Tag"],
              ["rhythm", "Rhythm"],
            ]}
            value={groupBy}
            onChange={(v) => setGroupBy(v as GroupBy)}
          />
        </ControlRow>
        <ControlRow label="Show">
          <Segmented
            options={[
              ["all", "All"],
              ["active", "Active"],
              ["archived", "Archived"],
            ]}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
          />
        </ControlRow>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Nothing matches this filter.
        </p>
      ) : (
        groups.map((g) => (
          <Group key={g.key} label={g.label} count={g.items.length}>
            {g.items.map((s) => (
              <ShareCard
                key={s.shareId}
                share={s}
                tagMap={tagMap}
                onCopy={onCopy}
              />
            ))}
          </Group>
        ))
      )}
    </div>
  );
}

function buildShareGroups(
  rows: SharedActivity[],
  groupBy: GroupBy
): ShareGroup[] {
  if (groupBy === "status") {
    const active = rows.filter((s) => s.archivedAt === null);
    const archived = rows.filter((s) => s.archivedAt !== null);
    const out: ShareGroup[] = [];
    if (active.length > 0 || archived.length === 0)
      out.push({ key: "active", label: "Active", items: sortByName(active) });
    if (archived.length > 0)
      out.push({
        key: "archived",
        label: "Archived",
        items: sortByName(archived),
      });
    return out;
  }
  if (groupBy === "rhythm") {
    return groupShares(rows, (s) =>
      rhythmCategoryLabel(s.rhythm, s.scheduledTimes)
    );
  }
  // tag
  return groupShares(rows, (s) => s.defaultSkillTags[0] ?? "No tag");
}

function groupShares(
  rows: SharedActivity[],
  keyOf: (s: SharedActivity) => string
): ShareGroup[] {
  const buckets = new Map<string, SharedActivity[]>();
  for (const s of rows) {
    const k = keyOf(s);
    const arr = buckets.get(k);
    if (arr) arr.push(s);
    else buckets.set(k, [s]);
  }
  return Array.from(buckets.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((k) => ({ key: k, label: k, items: sortByName(buckets.get(k) ?? []) }));
}

function sortByName(rows: SharedActivity[]): SharedActivity[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

function ControlRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {children}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<readonly [string, string]>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([val, label]) => {
        const active = val === value;
        return (
          <button
            key={val}
            type="button"
            onClick={() => onChange(val)}
            className={`touch-manipulation rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function Group({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <details open className="rounded-md border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
        {label} ({count})
      </summary>
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        {count === 0 ? (
          <p className="px-1 py-2 text-sm text-zinc-500">None.</p>
        ) : (
          <ul className="flex flex-col gap-2">{children}</ul>
        )}
      </div>
    </details>
  );
}

function ShareCard({
  share,
  tagMap,
  onCopy,
}: {
  share: SharedActivity;
  tagMap: TagMap;
  onCopy: (s: SharedActivity) => void;
}) {
  const archived = share.archivedAt !== null;
  return (
    <li className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`truncate font-medium ${
              archived ? "text-zinc-500 line-through" : ""
            }`}
          >
            {share.name}
          </span>
          {archived ? (
            <Badge label="Archived" />
          ) : (
            !share.shareProgress && <Badge label="Template only" />
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-zinc-600 dark:text-zinc-400">
          {summarizeRhythm(share.rhythm, share.scheduledTimes)}
        </p>
        {share.defaultSkillTags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            <TagChipList
              names={share.defaultSkillTags}
              tags={tagMap}
              size="xs"
            />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onCopy(share)}
        className="shrink-0 touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        Copy to my schedule
      </button>
    </li>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Calendar — occurrences grouped by day (only progress-shared rhythms have
// any). Read-only: each row shows the status, no actions.
// ---------------------------------------------------------------------------

function CalendarReadOnly({
  shares,
  instances,
  todayStr,
  friendName,
}: {
  shares: SharedActivity[];
  instances: SharedInstance[];
  todayStr: string;
  friendName: string;
}) {
  const byId = useMemo(
    () => new Map(shares.map((s) => [s.activityId, s])),
    [shares]
  );

  // Group instances by date (ascending), today and future first feels
  // natural but a simple chronological list is clearest for a glance.
  const days = useMemo(() => {
    const map = new Map<string, SharedInstance[]>();
    for (const inst of instances) {
      const arr = map.get(inst.scheduledFor);
      if (arr) arr.push(inst);
      else map.set(inst.scheduledFor, [inst]);
    }
    return Array.from(map.keys())
      .sort((a, b) => a.localeCompare(b))
      .map((date) => ({ date, items: map.get(date) ?? [] }));
  }, [instances]);

  if (days.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
        Nothing on {friendName}&rsquo;s calendar — they haven&rsquo;t shared
        any active rhythms with progress.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {days.map(({ date, items }) => (
        <section key={date} className="flex flex-col gap-2">
          <h2 className="flex items-baseline gap-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
            <span>{formatDateMedium(date)}</span>
            {date === todayStr && (
              <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-white dark:bg-zinc-50 dark:text-zinc-900">
                Today
              </span>
            )}
          </h2>
          <ul className="flex flex-col gap-2">
            {items.map((inst) => {
              const act = byId.get(inst.activityId);
              return (
                <li
                  key={inst.instanceId}
                  className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      {act
                        ? rhythmCategoryLabel(act.rhythm, act.scheduledTimes)
                        : ""}
                    </p>
                    <p className="truncate font-medium">
                      {act?.name ?? "Activity"}
                    </p>
                  </div>
                  <StatusPill
                    status={inst.status}
                    scheduledFor={inst.scheduledFor}
                    todayStr={todayStr}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function StatusPill({
  status,
  scheduledFor,
  todayStr,
}: {
  status: SharedInstance["status"];
  scheduledFor: string;
  todayStr: string;
}) {
  let label = "Pending";
  let cls =
    "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400";
  if (status === "completed") {
    label = "✓ Done";
    cls = "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  } else if (status === "missed") {
    label = "✗ Missed";
    cls = "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300";
  } else if (scheduledFor < todayStr) {
    label = "Unlabeled";
    cls = "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  }
  return (
    <span
      className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Grid — read-only heatmap, one row per shared rhythm. Columns span the
// actual range of shared occurrences (so future-scheduled days show too,
// which is what was making the old "last 35 days" version look empty for a
// freshly-shared rhythm). Mirrors the individual grid's colors + a Success
// column + legend.
// ---------------------------------------------------------------------------

function GridReadOnly({
  shares,
  instances,
  todayStr,
  friendName,
}: {
  shares: SharedActivity[];
  instances: SharedInstance[];
  todayStr: string;
  friendName: string;
}) {
  const byId = useMemo(
    () => new Map(shares.map((s) => [s.activityId, s])),
    [shares]
  );

  // Rows: activities that actually have shared occurrences (progress shared,
  // non-archived). Others live only in Total.
  const rows = useMemo(() => {
    const ids = new Set(instances.map((i) => i.activityId));
    return Array.from(ids)
      .map((id) => byId.get(id))
      .filter((s): s is SharedActivity => Boolean(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [instances, byId]);

  // Columns derived from the real occurrence range (always including today
  // as the right edge), clamped to the most recent GRID_MAX_COLS days.
  const cols = useMemo(() => {
    if (instances.length === 0) return [];
    let min = instances[0].scheduledFor;
    let max = instances[0].scheduledFor;
    for (const i of instances) {
      if (i.scheduledFor < min) min = i.scheduledFor;
      if (i.scheduledFor > max) max = i.scheduledFor;
    }
    if (max < todayStr) max = todayStr;
    const all = enumerateDates(min, max);
    return all.length > GRID_MAX_COLS
      ? all.slice(all.length - GRID_MAX_COLS)
      : all;
  }, [instances, todayStr]);

  // (activityId|date) → instance for O(1) cell lookup.
  const cellByKey = useMemo(() => {
    const m = new Map<string, SharedInstance>();
    for (const inst of instances) {
      m.set(`${inst.activityId}|${inst.scheduledFor}`, inst);
    }
    return m;
  }, [instances]);

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
        Nothing to chart — {friendName} hasn&rsquo;t shared any active rhythms
        with progress.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0 text-xs">
          <tbody>
            {rows.map((s) => {
              const st = rowStats(s.activityId, cols, cellByKey, todayStr);
              return (
                <tr key={s.shareId}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-white pr-2 text-left align-middle dark:bg-zinc-950"
                  >
                    <span className="block max-w-[7rem] truncate text-xs font-medium">
                      {s.name}
                    </span>
                    <span className="block text-[10px] text-zinc-400">
                      {rhythmCategoryLabel(s.rhythm, s.scheduledTimes)}
                    </span>
                  </th>
                  {cols.map((date) => {
                    const inst = cellByKey.get(`${s.activityId}|${date}`);
                    return (
                      <td key={date} className="p-px">
                        <div
                          title={`${s.name} · ${date}${
                            inst ? ` · ${inst.status}` : ""
                          }`}
                          className={`h-3.5 w-3.5 rounded-[2px] ${gridCellClass(
                            inst?.status,
                            date,
                            todayStr
                          )}`}
                        />
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 bg-white pl-2 text-right align-middle tabular-nums dark:bg-zinc-950">
                    {st.pct === null ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <span className={pctClass(st.pct)}>
                        {st.done}/{st.onHook} · {st.pct}%
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
        <Legend className="bg-emerald-500" label="Done" />
        <Legend className="bg-red-500" label="Missed" />
        <Legend className="bg-amber-300 dark:bg-amber-700" label="Unlabeled" />
        <Legend
          className="border border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900"
          label="Scheduled"
        />
      </p>
    </div>
  );
}

function rowStats(
  activityId: string,
  cols: string[],
  cellByKey: Map<string, SharedInstance>,
  todayStr: string
): { done: number; onHook: number; pct: number | null } {
  let done = 0;
  let missed = 0;
  let overdue = 0;
  for (const date of cols) {
    const inst = cellByKey.get(`${activityId}|${date}`);
    if (!inst) continue;
    if (inst.status === "completed") done++;
    else if (inst.status === "missed") missed++;
    else if (inst.status === "pending" && date < todayStr) overdue++;
  }
  const onHook = done + missed + overdue;
  const pct = onHook > 0 ? Math.round((done / onHook) * 100) : null;
  return { done, onHook, pct };
}

function gridCellClass(
  status: SharedInstance["status"] | undefined,
  date: string,
  todayStr: string
): string {
  if (status === "completed") return "bg-emerald-500";
  if (status === "missed") return "bg-red-500";
  if (status === "pending") {
    return date < todayStr
      ? "bg-amber-300 dark:bg-amber-700"
      : "border border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900";
  }
  if (status === "skipped" || status === "shifted") {
    return "bg-zinc-200 dark:bg-zinc-800";
  }
  // No occurrence scheduled this day.
  return "bg-transparent";
}

function pctClass(pct: number): string {
  if (pct >= 80) return "font-semibold text-emerald-700 dark:text-emerald-300";
  if (pct >= 50) return "text-amber-700 dark:text-amber-300";
  return "text-red-700 dark:text-red-300";
}

// Enumerate YYYY-MM-DD from `from` to `to` inclusive (lexicographic ==
// chronological for this format). Guard caps runaway ranges.
function enumerateDates(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard < 2000) {
    out.push(cur);
    cur = addDaysToYmd(cur, 1);
    guard++;
  }
  return out;
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-3 w-3 rounded-sm ${className}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------

function formatDateMedium(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function addDaysToYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
