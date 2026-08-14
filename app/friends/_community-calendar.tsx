"use client";

// ---------------------------------------------------------------------------
// CommunityOwnedCalendar — a community's OWN calendar (migration 0056).
//
// The community owns its activities + occurrences; any member can mark an
// occurrence complete/missed for the whole community (collective completion),
// and members with the "Manage activities" permission can add activities.
// Rendering reuses FriendCalendar (Day/Week/Month/Year), matching the
// personal calendar's appearance; completion + creation are wired to the
// community-owned RPCs.
// ---------------------------------------------------------------------------

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  archiveCommunityCalendarActivity,
  createCommunityCalendarActivity,
  deleteCommunityCalendarActivity,
  getCommunityYearCounts,
  restoreCommunityCalendarActivity,
  setCommunityInstanceStatus,
  updateCommunityCalendarActivity,
  type CommunityActivityBundle,
  type CommunityDetail,
} from "@/app/actions/communities";
import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import { summarizeRhythm } from "@/lib/domain/rhythm-summary";
import { tagChipClasses, type TagMap } from "@/lib/domain/tags";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";
import {
  normalizeFrequencyPeriod,
  type DayOfWeek,
  type Rhythm,
} from "@/lib/validators/rhythm";

import { FriendCalendar } from "./[friendId]/friend-calendar";
import { FriendGrid } from "./[friendId]/friend-grid";
import type { Occurrence } from "./[friendId]/shared-data";

type CalView = "calendar" | "grid";

export function CommunityOwnedCalendar({
  detail,
  bundle,
}: {
  detail: CommunityDetail;
  bundle: CommunityActivityBundle;
}) {
  const router = useRouter();
  const canManage = detail.myPermissions.can_add_activities;
  const [view, setView] = useState<CalView>("calendar");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SharedActivity | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [picked, setPicked] = useState<{
    instanceId: string;
    name: string;
    scheduledFor: string;
    status: SharedInstance["status"];
  } | null>(null);

  // Index owned occurrences by activity + day so tapping a cell resolves to
  // the concrete instance id (FriendCalendar hands back activityId + date).
  const instByKey = useMemo(() => {
    const m = new Map<string, SharedInstance>();
    for (const i of bundle.ownedInstances) {
      m.set(`${i.activityId}:${i.scheduledFor}`, i);
    }
    return m;
  }, [bundle.ownedInstances]);

  const nameById = useMemo(
    () => new Map(bundle.ownedActivities.map((a) => [a.activityId, a.name])),
    [bundle.ownedActivities]
  );

  function onOpen(activityId: string, occ: Occurrence | null) {
    if (!occ) return;
    const inst = instByKey.get(`${activityId}:${occ.scheduledFor}`);
    if (!inst) return;
    setPicked({
      instanceId: inst.instanceId,
      name: nameById.get(activityId) ?? "Activity",
      scheduledFor: inst.scheduledFor,
      status: inst.status,
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {detail.name} calendar
        </h3>
        {canManage && (
          <div className="flex shrink-0 gap-2">
            {bundle.ownedActivities.length > 0 && (
              <button
                type="button"
                onClick={() => setManageOpen(true)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Manage
              </button>
            )}
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              + Add activity
            </button>
          </div>
        )}
      </div>

      {bundle.ownedActivities.length === 0 ? (
        <p className="shrink-0 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {canManage
            ? "No activities yet — add one to build this community's calendar."
            : "No activities yet."}
        </p>
      ) : (
        <>
          {view === "calendar" ? (
            <FriendCalendar
              shares={bundle.ownedActivities}
              instances={bundle.ownedInstances}
              todayStr={bundle.todayStr}
              tagMap={bundle.tagMap}
              onOpenActivity={onOpen}
              fillHeight
              loadYearCounts={(yearStart) =>
                getCommunityYearCounts(detail.id, yearStart)
              }
              collective={{
                onComplete: async (id) => {
                  await setCommunityInstanceStatus(id, "completed");
                },
                onMiss: async (id) => {
                  await setCommunityInstanceStatus(id, "missed");
                },
                onReset: async (id) => {
                  await setCommunityInstanceStatus(id, "pending");
                },
              }}
            />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
              <FriendGrid
                friendId={detail.id}
                shares={bundle.ownedActivities}
                instances={bundle.ownedInstances}
                todayStr={bundle.todayStr}
                tagMap={bundle.tagMap}
                onOpenActivity={onOpen}
                streakMode="none"
                streakGoal={null}
                showStats={false}
                statsAccuracy={false}
              />
            </div>
          )}

          {/* Calendar / Grid switcher pinned at the BOTTOM (reversed
              left-to-right), matching the personal dashboard's section
              tabs sitting below the sub-tabs. */}
          <nav className="flex shrink-0 flex-row-reverse gap-1 rounded-md border border-zinc-200 p-0.5 dark:border-zinc-800">
            {(
              [
                ["calendar", "Calendar"],
                ["grid", "Grid"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setView(val)}
                className={`flex flex-1 items-center justify-center rounded px-3 py-0.5 text-center text-xs font-medium transition-colors ${
                  view === val
                    ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </>
      )}

      {manageOpen && (
        <ManageActivitiesModal
          activities={bundle.ownedActivities}
          archived={bundle.archivedActivities}
          tagMap={bundle.tagMap}
          showArchived={showArchived}
          setShowArchived={setShowArchived}
          onEdit={(a) => {
            setManageOpen(false);
            setEditing(a);
          }}
          onClose={() => setManageOpen(false)}
          onChanged={() => router.refresh()}
        />
      )}

      {picked && (
        <CompletionModal
          instanceId={picked.instanceId}
          name={picked.name}
          scheduledFor={picked.scheduledFor}
          status={picked.status}
          onClose={() => setPicked(null)}
          onChanged={() => {
            setPicked(null);
            router.refresh();
          }}
        />
      )}

      {(creating || editing) && (
        <ActivityFormModal
          communityId={detail.id}
          todayStr={bundle.todayStr}
          tagMap={bundle.tagMap}
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// ManageActivitiesModal — leadership manage list (edit / archive) + archived
// (restore / delete). Lifted into a modal so the calendar body can fill the
// app-shell and scroll on its own (no extra content pushing the layout).
// ---------------------------------------------------------------------------

function ManageActivitiesModal({
  activities,
  archived,
  tagMap,
  showArchived,
  setShowArchived,
  onEdit,
  onClose,
  onChanged,
}: {
  activities: SharedActivity[];
  archived: SharedActivity[];
  tagMap: TagMap;
  showArchived: boolean;
  setShowArchived: (fn: (v: boolean) => boolean) => void;
  onEdit: (a: SharedActivity) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  useBodyScrollLock();
  void tagMap;
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85svh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">
            Manage activities
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-500 hover:underline"
          >
            Done
          </button>
        </div>

        <ul className="flex flex-col gap-1.5">
          {activities.map((a) => (
            <li
              key={a.activityId}
              className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-1.5 dark:border-zinc-800"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.name}</p>
                <p className="truncate text-xs text-zinc-500">
                  {summarizeRhythm(a.rhythm, a.scheduledTimes)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => onEdit(a)}
                  className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Edit
                </button>
                <ArchiveButton
                  activityId={a.activityId}
                  name={a.name}
                  onDone={onChanged}
                />
              </div>
            </li>
          ))}
        </ul>

        {archived.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className="self-start text-xs font-medium text-zinc-500 hover:underline"
            >
              {showArchived ? "Hide" : "Show"} archived ({archived.length})
            </button>
            {showArchived && (
              <ul className="flex flex-col gap-1.5">
                {archived.map((a) => (
                  <li
                    key={a.activityId}
                    className="flex items-center justify-between gap-2 rounded-md border border-dashed border-zinc-300 px-3 py-1.5 dark:border-zinc-700"
                  >
                    <span className="min-w-0 truncate text-sm text-zinc-500">
                      {a.name}
                    </span>
                    <div className="flex shrink-0 gap-1">
                      <RestoreButton
                        activityId={a.activityId}
                        onDone={onChanged}
                      />
                      <DeleteButton
                        activityId={a.activityId}
                        name={a.name}
                        onDone={onChanged}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArchiveButton — soft-delete a community-owned activity (with a confirm).
// ---------------------------------------------------------------------------

function ArchiveButton({
  activityId,
  name,
  onDone,
}: {
  activityId: string;
  name: string;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function archive() {
    if (
      !window.confirm(
        `Archive "${name}"? It will be removed from the community calendar.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await archiveCommunityCalendarActivity(activityId);
      if (!("error" in res)) onDone();
    });
  }

  return (
    <button
      type="button"
      onClick={archive}
      disabled={isPending}
      className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
    >
      Archive
    </button>
  );
}

function RestoreButton({
  activityId,
  onDone,
}: {
  activityId: string;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const res = await restoreCommunityCalendarActivity(activityId);
          if (!("error" in res)) onDone();
        })
      }
      className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
    >
      Restore
    </button>
  );
}

function DeleteButton({
  activityId,
  name,
  onDone,
}: {
  activityId: string;
  name: string;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  function del() {
    if (
      !window.confirm(
        `Permanently delete "${name}"? This removes it and all its history for the community and can't be undone.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await deleteCommunityCalendarActivity(activityId);
      if (!("error" in res)) onDone();
    });
  }
  return (
    <button
      type="button"
      onClick={del}
      disabled={isPending}
      className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
    >
      Delete
    </button>
  );
}

// ---------------------------------------------------------------------------
// Completion modal — collective mark complete / missed / reset for one
// occurrence. Any member may do this.
// ---------------------------------------------------------------------------

function CompletionModal({
  instanceId,
  name,
  scheduledFor,
  status,
  onClose,
  onChanged,
}: {
  instanceId: string;
  name: string;
  scheduledFor: string;
  status: SharedInstance["status"];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useBodyScrollLock();

  function set(next: "pending" | "completed" | "missed") {
    setError(null);
    startTransition(async () => {
      const res = await setCommunityInstanceStatus(instanceId, next);
      if ("error" in res) setError(res.error);
      else onChanged();
    });
  }

  const btn =
    "rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50";

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-t-2xl bg-white p-5 shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{name}</h2>
          <p className="text-xs text-zinc-500">
            {formatDate(scheduledFor)} ·{" "}
            {status === "completed"
              ? "Completed"
              : status === "missed"
                ? "Missed"
                : "Pending"}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {status !== "completed" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => set("completed")}
              className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}
            >
              Mark complete
            </button>
          )}
          {status !== "missed" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => set("missed")}
              className={`${btn} bg-red-600 text-white hover:bg-red-500`}
            >
              Mark missed
            </button>
          )}
          {status !== "pending" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => set("pending")}
              className={`${btn} border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800`}
            >
              Reset to pending
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="self-end text-sm text-zinc-500 hover:underline"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create modal — a focused form for a community-owned activity. Covers the
// core rhythms (single / daily / weekdays / every-N-days / N×-per-period),
// optional times, tags, and a date range.
// ---------------------------------------------------------------------------

type RhythmType = "single" | "daily" | "weekdays" | "interval" | "frequency";

const WEEKDAYS: { key: DayOfWeek; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

function deriveInitial(existing?: SharedActivity | null): {
  rhythmType: RhythmType;
  days: DayOfWeek[];
  intervalDays: number;
  freqCount: number;
  freqPerCount: number;
  freqPerUnit: "days" | "weeks" | "months";
} {
  const base = {
    rhythmType: "daily" as RhythmType,
    days: [] as DayOfWeek[],
    intervalDays: 2,
    freqCount: 3,
    freqPerCount: 1,
    freqPerUnit: "weeks" as "days" | "weeks" | "months",
  };
  const r = existing?.rhythm;
  if (!r) return base;
  switch (r.type) {
    case "single":
      return { ...base, rhythmType: "single" };
    case "daily":
      return { ...base, rhythmType: "daily" };
    case "weekdays":
      return { ...base, rhythmType: "weekdays", days: r.days };
    case "interval":
      return { ...base, rhythmType: "interval", intervalDays: r.days };
    case "frequency": {
      const { perCount, perUnit } = normalizeFrequencyPeriod(r);
      return {
        ...base,
        rhythmType: "frequency",
        freqCount: r.count,
        freqPerCount: perCount,
        freqPerUnit: perUnit,
      };
    }
    default:
      return base;
  }
}

function ActivityFormModal({
  communityId,
  todayStr,
  tagMap,
  existing,
  onClose,
  onSaved,
}: {
  communityId: string;
  todayStr: string;
  tagMap: TagMap;
  existing?: SharedActivity | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useBodyScrollLock();

  const init = deriveInitial(existing);
  const [name, setName] = useState(existing?.name ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [rhythmType, setRhythmType] = useState<RhythmType>(init.rhythmType);
  const [days, setDays] = useState<DayOfWeek[]>(init.days);
  const [intervalDays, setIntervalDays] = useState(init.intervalDays);
  const [freqCount, setFreqCount] = useState(init.freqCount);
  const [freqPerCount, setFreqPerCount] = useState(init.freqPerCount);
  const [freqPerUnit, setFreqPerUnit] = useState<"days" | "weeks" | "months">(
    init.freqPerUnit
  );
  const [times, setTimes] = useState<string[]>(existing?.scheduledTimes ?? []);
  // Parallel to `times` — "" means no end for that slot (migration 0032).
  const [endTimes, setEndTimes] = useState<string[]>(() => {
    const t = existing?.scheduledTimes ?? [];
    const e = existing?.scheduledEndTimes ?? [];
    return t.map((_, i) => e[i] ?? "");
  });
  const [tagList, setTagList] = useState<string[]>(
    existing?.defaultSkillTags ?? []
  );
  const [tagInput, setTagInput] = useState("");
  const [startDate, setStartDate] = useState(existing?.startDate ?? todayStr);
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");

  const paletteTags = Object.keys(tagMap).sort();

  function toggleDay(d: DayOfWeek) {
    setDays((cur) =>
      cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]
    );
  }
  function toggleTag(name: string) {
    setTagList((cur) =>
      cur.includes(name) ? cur.filter((t) => t !== name) : [...cur, name]
    );
  }
  function addTypedTag() {
    const t = tagInput.trim();
    if (t && !tagList.includes(t)) setTagList((cur) => [...cur, t]);
    setTagInput("");
  }

  function buildRhythm(): Rhythm | { error: string } {
    switch (rhythmType) {
      case "single":
        return { type: "single" };
      case "daily":
        return { type: "daily" };
      case "weekdays":
        if (days.length === 0) return { error: "Pick at least one weekday." };
        return { type: "weekdays", days };
      case "interval":
        if (intervalDays < 1) return { error: "Interval must be ≥ 1 day." };
        return { type: "interval", days: intervalDays };
      case "frequency":
        if (freqCount < 1) return { error: "Count must be ≥ 1." };
        return {
          type: "frequency",
          count: freqCount,
          perCount: freqPerCount,
          perUnit: freqPerUnit,
        };
    }
  }

  function submit() {
    setError(null);
    if (name.trim().length === 0) {
      setError("Give the activity a name.");
      return;
    }
    const built = buildRhythm();
    if ("error" in built) {
      setError(built.error);
      return;
    }
    // Keep times + their end times aligned; drop blank time slots.
    const pairs = times
      .map((t, i) => ({ t: t.trim(), e: (endTimes[i] ?? "").trim() }))
      .filter((p) => p.t.length > 0);
    const cleanTimes = pairs.map((p) => p.t);
    const cleanEndTimes = pairs.map((p) => p.e);

    // Multi-time Daily behaves like the personal form: convert to an
    // N-times-per-day frequency so the X/Y progress model applies.
    let rhythm: Rhythm = built;
    if (rhythm.type === "daily" && cleanTimes.length > 1) {
      rhythm = {
        type: "frequency",
        count: cleanTimes.length,
        perCount: 1,
        perUnit: "days",
      };
    }

    startTransition(async () => {
      const res = existing
        ? await updateCommunityCalendarActivity({
            activityId: existing.activityId,
            name,
            notes: notes.trim() || undefined,
            rhythm,
            scheduledTimes: cleanTimes,
            scheduledEndTimes: cleanEndTimes,
            tags: tagList,
            startDate,
            endDate: endDate || null,
          })
        : await createCommunityCalendarActivity({
            communityId,
            name,
            notes: notes.trim() || undefined,
            rhythm,
            scheduledTimes: cleanTimes,
            scheduledEndTimes: cleanEndTimes,
            tags: tagList,
            startDate,
            endDate: endDate || null,
          });
      if ("error" in res) setError(res.error);
      else onSaved();
    });
  }

  const inputCls =
    "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <h2 className="text-xl font-semibold tracking-tight">
          {existing ? "Edit activity" : "Add activity"}
        </h2>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="e.g. Group run"
            className={inputCls}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            Notes <span className="font-normal text-zinc-500">(optional)</span>
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={inputCls}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Rhythm</span>
          <select
            value={rhythmType}
            onChange={(e) => setRhythmType(e.target.value as RhythmType)}
            className={inputCls}
          >
            <option value="single">Once</option>
            <option value="daily">Daily</option>
            <option value="weekdays">Days per Week</option>
            <option value="interval">Every N Days</option>
            <option value="frequency">Target Count</option>
          </select>
        </label>

        {rhythmType === "weekdays" && (
          <div className="flex flex-wrap gap-1">
            {WEEKDAYS.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => toggleDay(d.key)}
                aria-pressed={days.includes(d.key)}
                className={`rounded-md border px-2 py-1 text-xs font-medium ${
                  days.includes(d.key)
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                    : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}

        {rhythmType === "interval" && (
          <label className="flex items-center gap-2 text-sm">
            <span>Every</span>
            <input
              type="number"
              min={1}
              value={intervalDays}
              onChange={(e) => setIntervalDays(Number(e.target.value) || 1)}
              className={`${inputCls} w-20`}
            />
            <span>days</span>
          </label>
        )}

        {rhythmType === "frequency" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              type="number"
              min={1}
              max={99}
              value={freqCount}
              onChange={(e) => setFreqCount(Number(e.target.value) || 1)}
              className={`${inputCls} w-16`}
            />
            <span>times per</span>
            <input
              type="number"
              min={1}
              max={99}
              value={freqPerCount}
              onChange={(e) => setFreqPerCount(Number(e.target.value) || 1)}
              className={`${inputCls} w-16`}
            />
            <select
              value={freqPerUnit}
              onChange={(e) =>
                setFreqPerUnit(e.target.value as "days" | "weeks" | "months")
              }
              className={inputCls}
            >
              <option value="days">day(s)</option>
              <option value="weeks">week(s)</option>
              <option value="months">month(s)</option>
            </select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            Times of day{" "}
            <span className="font-normal text-zinc-500">
              {times.length > 0 ? `(${times.length} per day)` : "(optional)"}
            </span>
          </span>
          {times.map((t, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1.5">
              <input
                type="time"
                value={t}
                onChange={(e) =>
                  setTimes((cur) =>
                    cur.map((x, j) => (j === i ? e.target.value : x))
                  )
                }
                className={inputCls}
              />
              <span aria-hidden className="text-xs text-zinc-400">
                –
              </span>
              <input
                type="time"
                value={endTimes[i] ?? ""}
                title="End (optional)"
                onChange={(e) =>
                  setEndTimes((cur) =>
                    cur.map((x, j) => (j === i ? e.target.value : x))
                  )
                }
                className={inputCls}
              />
              {(endTimes[i] ?? "") !== "" && (
                <button
                  type="button"
                  onClick={() =>
                    setEndTimes((cur) => cur.map((x, j) => (j === i ? "" : x)))
                  }
                  aria-label="Clear end time"
                  title="No end time"
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  No end
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setTimes((cur) => cur.filter((_, j) => j !== i));
                  setEndTimes((cur) => cur.filter((_, j) => j !== i));
                }}
                aria-label="Remove time"
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setTimes((cur) => [...cur, "09:00"]);
              setEndTimes((cur) => [...cur, ""]);
            }}
            className="self-start rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            + Add time
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">
            Tags <span className="font-normal text-zinc-500">(optional)</span>
          </span>
          {tagList.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tagList.map((name) => {
                const info = tagMap[name];
                const cls = info
                  ? tagChipClasses(info.color)
                  : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleTag(name)}
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
                    title="Remove tag"
                  >
                    {name} ✕
                  </button>
                );
              })}
            </div>
          )}
          {paletteTags.filter((t) => !tagList.includes(t)).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {paletteTags
                .filter((t) => !tagList.includes(t))
                .map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleTag(name)}
                    className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    + {name}
                  </button>
                ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTypedTag();
                }
              }}
              placeholder="Add a tag…"
              className={`${inputCls} flex-1`}
            />
            <button
              type="button"
              onClick={addTypedTag}
              disabled={tagInput.trim().length === 0}
              className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Add
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-medium">Start</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm font-medium">
              End <span className="font-normal text-zinc-500">(optional)</span>
            </span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending || name.trim().length === 0}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending
              ? existing
                ? "Saving…"
                : "Adding…"
              : existing
                ? "Save changes"
                : "Add activity"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
