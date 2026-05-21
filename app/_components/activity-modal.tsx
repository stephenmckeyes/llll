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

import { useActionState, useEffect, useState, useTransition } from "react";

import {
  archiveActivity,
  completeInstance,
  missInstance,
  updateActivityFields,
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

import {
  normalizeReminder,
  type Reminder,
} from "@/lib/validators/reminder";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";
import { dispatchInstanceResolved } from "@/lib/ui/instance-resolved-event";

import { ActivityFormFields } from "./activity-form-fields";
import { ActivityHistoryModal } from "./activity-history-modal";
import type { DayInstance } from "./day-list";
import { formatReminder, RemindersField } from "./reminders-field";
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
  const [mode, setMode] = useState<Mode>("details");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const activity = instance.activity;
  const isSingle = activity.rhythm.type === "single";

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
                : activity.name}
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
            activity={activity}
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
            <Primary
              label="Complete"
              disabled={isPending}
              onClick={handleComplete}
            />
            <Secondary
              label="Missed"
              disabled={isPending}
              onClick={handleMissed}
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
          {PRIORITY_LABEL[activity.priority] ?? "Medium"}
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
  );
}

// ---------------------------------------------------------------------------
// Edit-activity body — inline form for name / notes / tags / priority.
// (Rhythm + dates + times come in the next dedicated turn.)
// ---------------------------------------------------------------------------

function EditActivityBody({
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
  // useActionState wants an action with shape (prev, formData) -> next state.
  // Bind the activity id up front so the action receives it server-side.
  const boundAction = updateActivityFields.bind(null, activity.id);
  const [state, formAction, isPending] = useActionState<
    UpdateActivityState,
    FormData
  >(boundAction, null);

  const [priority, setPriority] = useState<number>(activity.priority);
  const [reminders, setReminders] = useState<Reminder[]>(
    activity.reminders.map(normalizeReminder)
  );
  const isSingle = activity.rhythm.type === "single";

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

        {/* Scope warning. The edit fields here change activity-level
            metadata (name / notes / tags / priority / date range), not
            the rhythm. Schedule changes (when/how often it repeats)
            go through Edit Rhythm so the future instances get
            regenerated cleanly. Surface this up-front so the user
            doesn't expect "edit activity" to retroactively reshuffle
            their calendar. */}
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <strong>Heads up:</strong> these edits apply to this activity
          itself (name, notes, tags, dates, priority, reminders). To
          change the schedule (when / how often it repeats), use{" "}
          <em>Edit Rhythm</em> instead — that regenerates future
          occurrences.
        </p>

        <label className="block">
          <span className="text-sm font-medium">Activity</span>
          <input
            type="text"
            name="name"
            required
            maxLength={120}
            defaultValue={activity.name}
            className={inputClasses}
          />
        </label>

        <label className="mt-4 block">
          <span className="text-sm font-medium">
            Notes <span className="font-normal text-zinc-500">(optional)</span>
          </span>
          <textarea
            name="notes"
            rows={3}
            maxLength={500}
            defaultValue={activity.notes ?? ""}
            className={`${inputClasses} resize-none`}
          />
        </label>

        <div className="mt-4">
          <p className="mb-1 text-sm font-medium">Tags</p>
          {/* Same TagPicker as the create form. Hidden inputs emit
              `name="tag"` per selected — the updateActivityFields
              action reads them via formData.getAll("tag"). */}
          <TagPicker
            initialSelected={activity.default_skill_tags}
            initialTagMap={tagMap}
          />
        </div>

        {/* Dates. Editing these does NOT change the rhythm itself — for that
            use Edit rhythm. Pending future instances outside the new range
            are cleaned up server-side. */}
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Schedule</legend>
          <div className="mt-1 grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-zinc-500">
                Start date
              </span>
              <input
                type="date"
                name="startDate"
                required
                defaultValue={activity.start_date}
                className={`${inputClasses} mt-1`}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-zinc-500">
                End date{" "}
                <span className="font-normal">
                  {isSingle ? "(n/a for Once)" : "(optional)"}
                </span>
              </span>
              <input
                type="date"
                name="endDate"
                defaultValue={activity.end_date ?? ""}
                disabled={isSingle}
                className={`${inputClasses} mt-1`}
              />
            </label>
          </div>
        </fieldset>

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

        <div className="mt-4">
          <RemindersField
            reminders={reminders}
            setReminders={setReminders}
          />
        </div>

        {/* Hidden inputs to surface the controlled reminders state in
            FormData (the visible inputs inside RemindersField already do
            this; this is belt-and-suspenders in case React strips the
            uncontrolled inputs during fast re-renders). */}

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

function EditRhythmBody({
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
          Saving regenerates this activity&rsquo;s future schedule. Past
          occurrences and their completions are kept; you&rsquo;ll be asked
          to confirm before changes apply.
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
