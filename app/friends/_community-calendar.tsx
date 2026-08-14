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

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  archiveCommunityCalendarActivity,
  createCommunityActivityFormAction,
  deleteCommunityCalendarActivity,
  getCommunityMonthBanners,
  getCommunityYearCounts,
  restoreCommunityCalendarActivity,
  setCommunityInstanceStatus,
  setCommunityMemberStatus,
  updateCommunityActivityFormAction,
  type CommunityActivityBundle,
  type CommunityDetail,
} from "@/app/actions/communities";
import type { SharedActivity, SharedInstance } from "@/app/actions/sharing";
import {
  ActivityFormFields,
  type ActivityFormInitial,
} from "@/app/_components/activity-form-fields";
import { summarizeRhythm } from "@/lib/domain/rhythm-summary";
import { type TagMap } from "@/lib/domain/tags";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

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

      {/* Always render the calendar shell — even with zero activities it
          shows the empty Day/Week/Month/Year (and Grid) exactly like the
          personal calendar, so every community calendar looks identical
          regardless of content. The "+ Add activity" CTA lives in the
          header for members who can manage. */}
      {
        <>
          {view === "calendar" ? (
            <FriendCalendar
              shares={bundle.ownedActivities}
              instances={bundle.ownedInstances}
              todayStr={bundle.todayStr}
              tagMap={bundle.tagMap}
              onOpenActivity={onOpen}
              fillHeight
              endless
              loadYearCounts={(yearStart) =>
                getCommunityYearCounts(detail.id, yearStart)
              }
              monthLoader={(monthKey) =>
                getCommunityMonthBanners(detail.id, monthKey)
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
              aggregate={{
                getInfo: (id) => bundle.aggregateByInstance[id],
                onSetMine: async (id, status) => {
                  await setCommunityMemberStatus(id, status);
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
      }

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
  useBodyScrollLock();

  // Reuse the SAME shared field body as the personal edit-rhythm modal
  // (activity-form-fields.tsx), driven by native FormData. Fields that
  // don't map to a community are hidden (priority / streaks / pinned /
  // reminders / rollover); "auto-drop when past" stays. Submission goes
  // through a FormData server action bound with the community/activity id,
  // so there's ONE form body shared with the personal calendar.
  const boundAction = existing
    ? updateCommunityActivityFormAction.bind(null, existing.activityId)
    : createCommunityActivityFormAction.bind(null, communityId);
  const [state, formAction, isPending] = useActionState(boundAction, null);

  // On success the action returns { ok: true }; close + refresh then.
  useEffect(() => {
    if (state && "ok" in state) onSaved();
  }, [state, onSaved]);

  const initialValues: ActivityFormInitial = {
    name: existing?.name ?? "",
    notes: existing?.notes ?? null,
    rhythm: existing?.rhythm ?? { type: "single" },
    priority: existing?.priority ?? 2,
    scheduled_times: existing?.scheduledTimes ?? [],
    scheduled_end_times: existing?.scheduledEndTimes ?? [],
    default_skill_tags: existing?.defaultSkillTags ?? [],
    start_date: existing?.startDate ?? todayStr,
    end_date: existing?.endDate ?? null,
    // ActivityFormInitial.reminders is legacy-typed {amount,unit}[]; real
    // data (and RemindersField) use {days,hours,minutes}, coerced by
    // normalizeReminder. Cast through unknown at the boundary.
    reminders: (existing?.reminders ??
      []) as unknown as ActivityFormInitial["reminders"],
    track_on_grid: existing?.trackOnGrid ?? false,
    rollover_missed_days: existing?.rolloverMissedDays ?? false,
    rollover_change_rhythm: existing?.rolloverChangeRhythm ?? false,
    auto_archive: false,
    pinned: existing?.pinned ?? false,
    auto_resolve: existing?.autoResolve ?? false,
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-zinc-950">
      <form
        action={formAction}
        className="mx-auto flex w-full max-w-md min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-6"
      >
        <div className="flex shrink-0 items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
          >
            ← Back
          </button>
        </div>
        <h2 className="text-2xl font-semibold tracking-tight">
          {existing ? "Edit activity" : "Add activity"}
        </h2>

        {/* Full option parity with the personal add/edit form: Streaks,
            Pinned, Rollover, Reminders all show (Priority stays hidden by
            the compact density, matching the personal compact form) — plus
            the community-only completion-type toggle. */}
        <ActivityFormFields
          initialValues={initialValues}
          tagMap={tagMap}
          showCompletionType
          initialCompletionType={existing?.completionType ?? "collective"}
        />

        {state && "error" in state && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
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
            type="submit"
            disabled={isPending}
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
      </form>
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
