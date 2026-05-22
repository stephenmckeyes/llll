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

// How many days back the read-only grid heatmap covers (ending today).
const GRID_DAYS = 35;

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

function TotalReadOnly({
  shares,
  tagMap,
  onCopy,
}: {
  shares: SharedActivity[];
  tagMap: TagMap;
  onCopy: (s: SharedActivity) => void;
}) {
  const active = shares
    .filter((s) => s.archivedAt === null)
    .sort((a, b) => a.name.localeCompare(b.name));
  const archived = shares
    .filter((s) => s.archivedAt !== null)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex flex-col gap-4">
      <Group label="Active" count={active.length}>
        {active.map((s) => (
          <ShareCard key={s.shareId} share={s} tagMap={tagMap} onCopy={onCopy} />
        ))}
      </Group>
      {archived.length > 0 && (
        <Group label="Archived" count={archived.length}>
          {archived.map((s) => (
            <ShareCard
              key={s.shareId}
              share={s}
              tagMap={tagMap}
              onCopy={onCopy}
            />
          ))}
        </Group>
      )}
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
// Grid — compact read-only heatmap of the last GRID_DAYS days.
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
  // Activities that actually have shared occurrences (progress shared,
  // non-archived). Others live only in Total.
  const activeShares = useMemo(() => {
    const withInstances = new Set(instances.map((i) => i.activityId));
    return shares
      .filter((s) => withInstances.has(s.activityId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [shares, instances]);

  // Columns: the last GRID_DAYS days ending today.
  const cols = useMemo(() => {
    const out: string[] = [];
    for (let i = GRID_DAYS - 1; i >= 0; i--) out.push(addDaysToYmd(todayStr, -i));
    return out;
  }, [todayStr]);

  // (activityId|date) → status for O(1) cell lookup.
  const statusByCell = useMemo(() => {
    const m = new Map<string, SharedInstance["status"]>();
    for (const inst of instances) {
      m.set(`${inst.activityId}|${inst.scheduledFor}`, inst.status);
    }
    return m;
  }, [instances]);

  if (activeShares.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
        Nothing to chart — {friendName} hasn&rsquo;t shared any active rhythms
        with progress.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-0.5">
        <tbody>
          {activeShares.map((s) => (
            <tr key={s.shareId}>
              <td className="sticky left-0 z-10 bg-white pr-2 align-middle dark:bg-zinc-950">
                <span className="block max-w-[8rem] truncate text-xs font-medium">
                  {s.name}
                </span>
              </td>
              {cols.map((date) => {
                const status = statusByCell.get(`${s.activityId}|${date}`);
                return (
                  <td key={date} className="p-0">
                    <div
                      title={`${s.name} · ${date}${
                        status ? ` · ${status}` : ""
                      }`}
                      className={`h-4 w-4 rounded-sm ${cellClass(
                        status,
                        date,
                        todayStr
                      )}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
        <Legend className="bg-emerald-500" label="Done" />
        <Legend className="bg-red-500" label="Missed" />
        <Legend className="bg-amber-400" label="Unlabeled" />
        <Legend className="bg-zinc-200 dark:bg-zinc-800" label="Scheduled" />
      </p>
    </div>
  );
}

function cellClass(
  status: SharedInstance["status"] | undefined,
  date: string,
  todayStr: string
): string {
  if (status === "completed") return "bg-emerald-500";
  if (status === "missed") return "bg-red-500";
  if (status === "pending") {
    return date < todayStr
      ? "bg-amber-400"
      : "bg-zinc-200 dark:bg-zinc-800";
  }
  // No occurrence on this day.
  return "bg-transparent";
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
