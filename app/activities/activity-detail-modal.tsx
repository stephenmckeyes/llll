"use client";

// ---------------------------------------------------------------------------
// ActivityDetailModal — opened by clicking an activity in the Total View.
//
// Deliberately narrower than the Day-view ActivityModal: there's no
// Complete/Missed here (you're managing the activity itself, not one
// occurrence). The only actions are:
//   - Edit rhythm   — reuses the same inline form as the Day modal.
//   - History       — the per-activity completion history.
//   - Archive       — soft-delete; drops all future occurrences from the
//                     calendar (history kept). Confirmed first.
//   - Unarchive     — only for archived rows; opens the full edit form so
//                     baseline info is re-validated before it goes live.
//   - Delete        — only for archived rows; PERMANENT, confirmed first.
//
// Closes on outside click, Escape, or ×.
// ---------------------------------------------------------------------------

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  archiveActivity,
  deleteActivity,
  setTrackOnGrid,
} from "@/app/actions/activities";
import { EditRhythmBody } from "@/app/_components/activity-modal";
import { ActivityHistoryModal } from "@/app/_components/activity-history-modal";
import type { ActivityFormInitial } from "@/app/_components/activity-form-fields";
import { TagChipList } from "@/app/_components/tag-chip";
import {
  summarizeDateRange,
  summarizeRhythm,
  summarizeScheduledTimes,
} from "@/lib/domain/rhythm-summary";
import type { TagMap } from "@/lib/domain/tags";
import { normalizeReminder } from "@/lib/validators/reminder";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

import { formatReminder } from "@/app/_components/reminders-field";

import { UnarchiveModal } from "./unarchive-modal";

const PRIORITY_LABEL: Record<number, string> = {
  1: "High",
  2: "Medium",
  3: "Low",
};

/** Everything the Total View modal needs about an activity. Superset of
 *  ActivityFormInitial (which Edit rhythm / Unarchive consume) plus the id
 *  and archived flag the action buttons key off. */
export type ActivityRow = ActivityFormInitial & {
  id: string;
  archived_at: string | null;
  created_at: string;
  track_on_grid: boolean;
};

type Mode = "details" | "edit-rhythm";

export function ActivityDetailModal({
  activity,
  tagMap,
  onClose,
}: {
  activity: ActivityRow;
  tagMap: TagMap;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("details");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [unarchiveOpen, setUnarchiveOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [onGrid, setOnGrid] = useState(activity.track_on_grid);

  const isSingle = activity.rhythm.type === "single";
  const archived = activity.archived_at !== null;

  function toggleGrid() {
    const next = !onGrid;
    setOnGrid(next); // optimistic
    startTransition(async () => {
      await setTrackOnGrid(activity.id, next);
      router.refresh();
    });
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useBodyScrollLock();

  function handleArchive() {
    const ok = window.confirm(
      "Archive this activity?\n\n" +
        "All of its future occurrences will be dropped from your calendar " +
        "and grid. Its past history is kept, and you can unarchive it later."
    );
    if (!ok) return;
    onClose();
    startTransition(async () => {
      await archiveActivity(activity.id);
      router.refresh();
    });
  }

  function handleDelete() {
    const ok = window.confirm(
      "Permanently delete this activity AND its entire history? This cannot be undone."
    );
    if (!ok) return;
    onClose();
    startTransition(async () => {
      await deleteActivity(activity.id);
      router.refresh();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-detail-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2
              id="activity-detail-title"
              className="break-words text-xl font-semibold tracking-tight"
            >
              {mode === "edit-rhythm" ? "Edit rhythm" : activity.name}
            </h2>
            {mode === "details" && archived && (
              <span className="mt-1 inline-block rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                Archived
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={mode !== "details" ? () => setMode("details") : onClose}
            aria-label={mode !== "details" ? "Cancel edit" : "Close"}
            className="-mr-1 shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        {mode === "details" ? (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <dl className="flex flex-col gap-2 text-sm">
                <DetailRow label="Rhythm">
                  {summarizeRhythm(activity.rhythm, activity.scheduled_times)}
                </DetailRow>
                {activity.scheduled_times.length > 0 && (
                  <DetailRow label="Time">
                    {summarizeScheduledTimes(activity.scheduled_times)}
                  </DetailRow>
                )}
                <DetailRow label={isSingle ? "Scheduled" : "Range"}>
                  {summarizeDateRange(
                    activity.start_date,
                    activity.end_date,
                    isSingle
                  )}
                </DetailRow>
                <DetailRow label="Priority">
                  {PRIORITY_LABEL[activity.priority] ?? "Medium"}
                </DetailRow>
              </dl>

              {/* Grid display toggle — everything is tracked regardless. */}
              <div className="mt-4 flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Show on Grid</p>
                  <p className="text-xs text-zinc-500">
                    Tracked either way — this only controls grid display.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={toggleGrid}
                  disabled={isPending}
                  role="switch"
                  aria-checked={onGrid}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                    onGrid ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      onGrid ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>

              {activity.notes && (
                <div className="mt-5">
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Notes
                  </h3>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {activity.notes}
                  </p>
                </div>
              )}

              {activity.default_skill_tags.length > 0 && (
                <div className="mt-5">
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Tags
                  </h3>
                  <TagChipList
                    names={activity.default_skill_tags}
                    tags={tagMap}
                    size="sm"
                  />
                </div>
              )}

              <div className="mt-5">
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Reminders
                </h3>
                {activity.reminders.length === 0 ? (
                  <p className="text-sm text-zinc-500">None</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {activity.reminders.map((r, i) => (
                      <li key={i}>{formatReminder(normalizeReminder(r))}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Action bar */}
            <div className="flex flex-wrap gap-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <Secondary
                label="Edit rhythm"
                disabled={isPending}
                onClick={() => setMode("edit-rhythm")}
              />
              <Secondary
                label="History"
                disabled={isPending}
                onClick={() => setHistoryOpen(true)}
              />
              {archived ? (
                <>
                  <Secondary
                    label="Unarchive"
                    disabled={isPending}
                    onClick={() => setUnarchiveOpen(true)}
                  />
                  <Danger
                    label="Delete"
                    disabled={isPending}
                    onClick={handleDelete}
                  />
                </>
              ) : (
                <Danger
                  label="Archive"
                  disabled={isPending}
                  onClick={handleArchive}
                />
              )}
            </div>
          </>
        ) : (
          <EditRhythmBody
            activity={activity}
            tagMap={tagMap}
            onDone={() => {
              onClose();
              router.refresh();
            }}
            onCancel={() => setMode("details")}
          />
        )}
      </div>

      {historyOpen && (
        <ActivityHistoryModal
          activityId={activity.id}
          activityName={activity.name}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {unarchiveOpen && (
        <UnarchiveModal
          activity={activity}
          tagMap={tagMap}
          onClose={() => {
            setUnarchiveOpen(false);
            // The unarchive action revalidates /activities; close the
            // whole modal so the user sees the row in its new state.
            onClose();
          }}
        />
      )}
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-32 shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

function Secondary({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex-1 touch-manipulation rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      {label}
    </button>
  );
}

function Danger({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex-1 touch-manipulation rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
    >
      {label}
    </button>
  );
}
