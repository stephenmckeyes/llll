"use client";

// ---------------------------------------------------------------------------
// Activity-details modal. Opened by tapping a Day-view row. Shows the
// activity in full (no truncation) with a sticky bottom action bar.
//
// Modes:
//   - 'details'       — read-only view + action bar (Complete/Missed/Edit/Drop)
//   - 'edit-activity' — inline form for name + notes + tags + priority
// Rhythm editing still links out to the dedicated /edit?section=rhythm page
// because changing the rhythm requires regenerating future instances, which
// is its own focused turn.
//
// Closes on: outside click, Escape, or the explicit ×.
// ---------------------------------------------------------------------------

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";

import {
  archiveActivity,
  completeInstance,
  missInstance,
  unlabelInstance,
  updateInstanceFields,
  updateActivityRhythm,
  type UpdateActivityRhythmState,
  type UpdateActivityState,
} from "@/app/actions/activities";
import {
  summarizeDateRange,
  summarizeRhythm,
  summarizeScheduledTimes,
} from "@/lib/domain/rhythm-summary";
import type { TagMap } from "@/lib/domain/tags";

import { normalizeReminder } from "@/lib/validators/reminder";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";
import { dispatchInstanceResolved } from "@/lib/ui/instance-resolved-event";

import { ActivityFormFields } from "./activity-form-fields";
import { ActivityHistoryModal } from "./activity-history-modal";
import { CommentModal } from "./comment-modal";
import type { DayInstance } from "./day-list";
import { formatReminder } from "./reminders-field";
import { TagChipList } from "./tag-chip";
import { TagPicker } from "./tag-picker";

const PRIORITY_LABEL: Record<number, string> = {
  1: "High",
  2: "Medium",
  3: "Low",
};

type Mode = "details" | "edit-activity" | "edit-rhythm";

const inputClasses =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50 dark:disabled:bg-zinc-950";

export function ActivityModal({
  instance,
  todayStr,
  onClose,
  tagMap,
}: {
  instance: DayInstance;
  todayStr: string;
  onClose: () => void;
  /** Per-user tag-name → color lookup. Drives both the details-mode
   *  TagChipList and the edit-mode TagPicker. Pass `{}` if you have
   *  none — chips fall back to gray. */
  tagMap: TagMap;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("details");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const activity = instance.activity;
  const isSingle = activity.rhythm.type === "single";

  // Effective per-occurrence values — an "Edit activity" override on
  // THIS instance wins over the series (activity) value.
  const effectiveName = instance.overrideName ?? activity.name;

  // Escape closes in any mode. Per user request, edit modes use the same
  // dismiss-on-outside-click as the details view; explicit Cancel buttons
  // are still available inside the form.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Body scroll-lock while open. Uses the ref-counted helper so
  // nested modals (e.g. Activity → History) don't leave the body
  // stuck at overflow:hidden when they unmount out of order.
  useBodyScrollLock();

  // Past-due-pending = "Unlabeled" for the chip's optimistic
  // decrement. Future-scheduled rows are never unlabeled, so resolving
  // one shouldn't tick the chip down.
  const isCurrentlyUnlabeled = instance.scheduled_for < todayStr;

  function handleComplete() {
    if (instance.scheduled_for > todayStr) {
      const ok = window.confirm(
        `This is scheduled for ${instance.scheduled_for}, in the future. Mark complete anyway?`
      );
      if (!ok) return;
    }
    onClose();
    if (isCurrentlyUnlabeled) {
      dispatchInstanceResolved({ wasUnlabeled: true });
    }
    startTransition(async () => {
      await completeInstance(instance.id);
      // The action no longer revalidates (so the Day view stays instant).
      // The modal is the entry point for the Grid / Week / Month views,
      // whose cells DON'T optimistically update — so refresh here to pull
      // the new status into those surfaces. router.refresh() is a
      // background transition; the modal has already closed.
      router.refresh();
    });
  }

  function handleMissed() {
    if (instance.scheduled_for > todayStr) {
      const ok = window.confirm(
        `This is scheduled for ${instance.scheduled_for}, in the future. Mark missed anyway?`
      );
      if (!ok) return;
    }
    onClose();
    if (isCurrentlyUnlabeled) {
      dispatchInstanceResolved({ wasUnlabeled: true });
    }
    startTransition(async () => {
      await missInstance(instance.id);
      router.refresh();
    });
  }

  function handleUnlabel() {
    // Revert an accidental complete/missed back to pending.
    onClose();
    startTransition(async () => {
      await unlabelInstance(instance.id);
      router.refresh();
    });
  }

  function handleDropAndSave() {
    const ok = window.confirm(
      "Drop this activity and save its history? You can recover it from Manage → Archived."
    );
    if (!ok) return;
    onClose();
    startTransition(async () => {
      await archiveActivity(activity.id);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2
            id="activity-modal-title"
            className="break-words text-xl font-semibold tracking-tight"
          >
            {mode === "edit-activity"
              ? "Edit activity"
              : mode === "edit-rhythm"
                ? "Edit rhythm"
                : effectiveName}
          </h2>
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
          <DetailsBody
            activity={activity}
            instance={instance}
            isSingle={isSingle}
            tagMap={tagMap}
          />
        ) : mode === "edit-activity" ? (
          <EditActivityBody
            instance={instance}
            tagMap={tagMap}
            onDone={() => onClose()}
            onCancel={() => setMode("details")}
          />
        ) : (
          <EditRhythmBody
            activity={activity}
            tagMap={tagMap}
            onDone={() => onClose()}
            onCancel={() => setMode("details")}
          />
        )}

        {mode === "details" && (
          <div className="flex flex-wrap gap-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            {/* Verdict buttons are status-aware: a row already marked
                completed/missed swaps that verdict's button for
                "Unlabel" (revert to pending) so an accidental tap is
                easy to undo, while still letting you switch to the other
                verdict. */}
            {instance.status === "completed" ? (
              <Secondary
                label="Unlabel"
                disabled={isPending}
                onClick={handleUnlabel}
              />
            ) : (
              <Primary
                label="Complete"
                disabled={isPending}
                onClick={handleComplete}
              />
            )}
            {instance.status === "missed" ? (
              <Secondary
                label="Unlabel"
                disabled={isPending}
                onClick={handleUnlabel}
              />
            ) : (
              <Secondary
                label="Missed"
                disabled={isPending}
                onClick={handleMissed}
              />
            )}
            {/* Comment on THIS occurrence — a post-hoc reflection
                shared with anyone the activity is shared with. The
                button reflects state: bold + ✓ mark when a comment
                already exists on this instance. */}
            <Secondary
              label={instance.comment ? "Comment ✓" : "Comment"}
              disabled={isPending}
              onClick={() => setCommentOpen(true)}
            />
            <Secondary
              label="Edit activity"
              disabled={isPending}
              onClick={() => setMode("edit-activity")}
            />
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
            <Danger
              label="Drop"
              disabled={isPending}
              onClick={handleDropAndSave}
            />
          </div>
        )}
      </div>

      {/* Nested history modal — lazy-mounts only when the user clicks
          History. fetchActivityHistory runs once when this mounts and
          renders straight away. Closing it returns the user to the
          parent ActivityModal in whatever mode it was in. */}
      {historyOpen && (
        <ActivityHistoryModal
          activityId={activity.id}
          activityName={activity.name}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {commentOpen && (
        <CommentModal
          instanceId={instance.id}
          activityName={activity.name}
          initialComment={instance.comment}
          onClose={() => setCommentOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details body — read-only view of the activity.
// ---------------------------------------------------------------------------

function DetailsBody({
  activity,
  instance,
  isSingle,
  tagMap,
}: {
  activity: DayInstance["activity"];
  instance: DayInstance;
  isSingle: boolean;
  tagMap: TagMap;
}) {
  // Effective per-occurrence values (override wins over series).
  const effectiveNotes = instance.overrideNotes ?? activity.notes;
  const effectivePriority = instance.overridePriority ?? activity.priority;
  return (
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
          {PRIORITY_LABEL[effectivePriority] ?? "Medium"}
        </DetailRow>
        {activity.rhythm.type === "frequency" && (
          <DetailRow label="Progress">
            {instance.completionCount} / {activity.rhythm.count}
          </DetailRow>
        )}
        <DetailRow label="This occurrence">
          {instance.scheduled_for}
        </DetailRow>
      </dl>

      {effectiveNotes && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Notes
          </h3>
          <p className="whitespace-pre-wrap break-words text-sm">
            {effectiveNotes}
          </p>
        </div>
      )}

      {instance.comment && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Comment
          </h3>
          <p className="whitespace-pre-wrap break-words rounded-md bg-zinc-50 px-3 py-2 text-sm italic text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
            {instance.comment}
          </p>
        </div>
      )}

      {instance.tags.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Tags
          </h3>
          <TagChipList
            names={instance.tags}
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
  );
}

// ---------------------------------------------------------------------------
// Edit-activity body — edits ONLY this single occurrence.
//
// Per-occurrence writable fields: name, notes, priority, tags, AND date
// (scheduled_for). "Everything about this instance" — no other
// occurrence of the series is touched. Series-wide edits (rhythm,
// schedule range, times of day, reminders) go through Edit Rhythm.
//
// Date semantics:
//   - Move this instance's scheduled_for to any date.
//   - Non-single rhythms: the parent rhythm keeps generating on its
//     normal schedule; only this one row moves. Two rows on a day are
//     visually fine (the day list renders them both). A collision on
//     the target date (another occurrence of THIS activity already
//     there) is caught server-side and surfaced as a clear error.
//   - Single rhythms: server-side ALSO updates activity.start_date +
//     end_date so backfill doesn't regenerate the old date.
// ---------------------------------------------------------------------------

function EditActivityBody({
  instance,
  tagMap,
  onDone,
  onCancel,
}: {
  instance: DayInstance;
  tagMap: TagMap;
  onDone: () => void;
  onCancel: () => void;
}) {
  const activity = instance.activity;
  // Bind to the INSTANCE id — updateInstanceFields writes per-occurrence
  // override columns on activity_instances, not the shared activity row.
  const boundAction = updateInstanceFields.bind(null, instance.id);
  const [state, formAction, isPending] = useActionState<
    UpdateActivityState,
    FormData
  >(boundAction, null);

  // Prefill with this occurrence's EFFECTIVE values (its override if it
  // has one, else the series value).
  const [priority, setPriority] = useState<number>(
    instance.overridePriority ?? activity.priority
  );
  const [scheduledFor, setScheduledFor] = useState<string>(
    instance.scheduled_for
  );

  // If the action returns ok, close the modal so the user sees the refreshed
  // data when they reopen it.
  useEffect(() => {
    if (state && "ok" in state && state.ok) {
      onDone();
    }
  }, [state, onDone]);

  return (
    <form
      action={formAction}
      onKeyDown={(e) => {
        // Don't let Enter auto-submit (consistent with the create form).
        const target = e.target as HTMLElement;
        if (
          e.key === "Enter" &&
          target.tagName !== "TEXTAREA" &&
          target.tagName !== "BUTTON"
        ) {
          e.preventDefault();
        }
      }}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <input type="hidden" name="priority" value={priority} />

        {/* Scope notice — these edits are per-occurrence only. */}
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <strong>Notice:</strong> These edits apply only to this single
          activity. To change future activities within this rhythm, use{" "}
          <em>Edit Rhythm</em>.
        </p>

        <label className="block">
          <span className="text-sm font-medium">Activity</span>
          <input
            type="text"
            name="name"
            required
            maxLength={120}
            defaultValue={instance.overrideName ?? activity.name}
            className={inputClasses}
          />
        </label>

        <label className="mt-4 block">
          <span className="text-sm font-medium">Date</span>
          <input
            type="date"
            name="scheduledFor"
            required
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            className={inputClasses}
          />
          {/* Date change nudge — non-single rhythms will still generate
              their normal occurrences on the ORIGINAL day; only this row
              moves. Singles keep the activity's start/end in sync. */}
          {scheduledFor !== instance.scheduled_for && (
            <p className="mt-1 text-xs text-zinc-500">
              {activity.rhythm.type === "single"
                ? "This one-off task will move to the new date."
                : "Only this occurrence moves. Future occurrences keep their normal schedule."}
            </p>
          )}
        </label>

        <label className="mt-4 block">
          <span className="text-sm font-medium">
            Notes <span className="font-normal text-zinc-500">(optional)</span>
          </span>
          <textarea
            name="notes"
            rows={3}
            maxLength={500}
            defaultValue={instance.overrideNotes ?? activity.notes ?? ""}
            className={`${inputClasses} resize-none`}
          />
        </label>

        <div className="mt-4">
          <p className="mb-1 text-sm font-medium">Tags</p>
          {/* Tags are already per-instance (snapshotted). Editing here
              writes this occurrence's `tags` only. */}
          <TagPicker
            initialSelected={instance.tags}
            initialTagMap={tagMap}
          />
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Priority</legend>
          <div className="mt-1 flex gap-2">
            {([1, 2, 3] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`flex-1 touch-manipulation rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  priority === p
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                    : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </fieldset>

        {state && "error" in state && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {state.error}
          </p>
        )}
      </div>

      {/* Edit-mode action bar replaces the details one. */}
      <div className="flex gap-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="flex-1 touch-manipulation rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Edit-rhythm body — full rhythm picker UI inline in the modal. On save,
// regenerates pending future instances via the updateActivityRhythm action.
// ---------------------------------------------------------------------------

export function EditRhythmBody({
  activity,
  tagMap,
  onDone,
  onCancel,
}: {
  activity: DayInstance["activity"];
  tagMap: TagMap;
  onDone: () => void;
  onCancel: () => void;
}) {
  // Edit-rhythm is now the "full reset" path — it edits every
  // future-facing field (name, notes, tags, priority, dates, reminders,
  // rhythm, scheduled times) AND regenerates the pending instance set.
  // Edit-activity remains the lighter touch (metadata only, no regen).
  //
  // All the field UI lives in ActivityFormFields (shared with the
  // unarchive-with-edit flow). This function just wires the form action,
  // the destructive-confirm prompt, and the submit-button bar.
  const boundAction = updateActivityRhythm.bind(null, activity.id);
  const [state, formAction, isPending] = useActionState<
    UpdateActivityRhythmState,
    FormData
  >(boundAction, null);

  useEffect(() => {
    if (state && "ok" in state && state.ok) onDone();
  }, [state, onDone]);

  return (
    <form
      action={(fd) => {
        // Confirmation popup before destructive regenerate.
        const ok = window.confirm(
          "Changing the rhythm will replace all future pending occurrences for this activity. Past occurrences and their completions are kept. Continue?"
        );
        if (!ok) return;
        return formAction(fd);
      }}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (
          e.key === "Enter" &&
          target.tagName !== "TEXTAREA" &&
          target.tagName !== "BUTTON"
        ) {
          e.preventDefault();
        }
      }}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <ActivityFormFields initialValues={activity} tagMap={tagMap} />

        <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Saving these edits will change this activity and all future
          activities made by this rhythm/schedule. Past occurrences
          remain unchanged. You will be asked to confirm before changes
          apply.
        </p>

        {state && "error" in state && (
          <p
            role="alert"
            className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {state.error}
          </p>
        )}
      </div>

      <div className="flex gap-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="flex-1 touch-manipulation rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="flex-1 touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? "Saving…" : "Save & regenerate"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

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

function Primary({
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
      className="flex-1 touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      {label}
    </button>
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
