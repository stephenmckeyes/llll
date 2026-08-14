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
  createCommunityCalendarActivity,
  setCommunityInstanceStatus,
  type CommunityActivityBundle,
  type CommunityDetail,
} from "@/app/actions/communities";
import type { SharedInstance } from "@/app/actions/sharing";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";
import type { DayOfWeek, Rhythm } from "@/lib/validators/rhythm";

import { FriendCalendar } from "./[friendId]/friend-calendar";
import type { Occurrence } from "./[friendId]/shared-data";

export function CommunityOwnedCalendar({
  detail,
  bundle,
}: {
  detail: CommunityDetail;
  bundle: CommunityActivityBundle;
}) {
  const router = useRouter();
  const canManage = detail.myPermissions.can_add_activities;
  const [creating, setCreating] = useState(false);
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
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {detail.name} calendar
        </h3>
        {canManage && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            + Add activity
          </button>
        )}
      </div>

      {bundle.ownedActivities.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {canManage
            ? "No activities yet — add one to build this community's calendar."
            : "No activities yet."}
        </p>
      ) : (
        <FriendCalendar
          shares={bundle.ownedActivities}
          instances={bundle.ownedInstances}
          todayStr={bundle.todayStr}
          tagMap={bundle.tagMap}
          onOpenActivity={onOpen}
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

      {creating && (
        <CreateCommunityActivityModal
          communityId={detail.id}
          todayStr={bundle.todayStr}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      )}
    </section>
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

function CreateCommunityActivityModal({
  communityId,
  todayStr,
  onClose,
  onCreated,
}: {
  communityId: string;
  todayStr: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  useBodyScrollLock();

  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [rhythmType, setRhythmType] = useState<RhythmType>("daily");
  const [days, setDays] = useState<DayOfWeek[]>([]);
  const [intervalDays, setIntervalDays] = useState(2);
  const [freqCount, setFreqCount] = useState(3);
  const [freqPerCount, setFreqPerCount] = useState(1);
  const [freqPerUnit, setFreqPerUnit] = useState<"days" | "weeks" | "months">(
    "weeks"
  );
  const [times, setTimes] = useState<string[]>([]);
  const [tags, setTags] = useState("");
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState("");

  function toggleDay(d: DayOfWeek) {
    setDays((cur) =>
      cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]
    );
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
    const rhythm = buildRhythm();
    if ("error" in rhythm) {
      setError(rhythm.error);
      return;
    }
    const cleanTimes = times.map((t) => t.trim()).filter(Boolean);
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    startTransition(async () => {
      const res = await createCommunityCalendarActivity({
        communityId,
        name,
        notes: notes.trim() || undefined,
        rhythm,
        scheduledTimes: cleanTimes,
        tags: tagList,
        startDate,
        endDate: endDate || null,
      });
      if ("error" in res) setError(res.error);
      else onCreated();
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
        <h2 className="text-xl font-semibold tracking-tight">Add activity</h2>

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
            <option value="single">One-off</option>
            <option value="daily">Every day</option>
            <option value="weekdays">Specific weekdays</option>
            <option value="interval">Every N days</option>
            <option value="frequency">N times per period</option>
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

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            Times <span className="font-normal text-zinc-500">(optional)</span>
          </span>
          {times.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
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
              <button
                type="button"
                onClick={() =>
                  setTimes((cur) => cur.filter((_, j) => j !== i))
                }
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTimes((cur) => [...cur, "09:00"])}
            className="self-start rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            + Add time
          </button>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            Tags{" "}
            <span className="font-normal text-zinc-500">
              (comma-separated, optional)
            </span>
          </span>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="fitness, outdoors"
            className={inputCls}
          />
        </label>

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
            {isPending ? "Adding…" : "Add activity"}
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
