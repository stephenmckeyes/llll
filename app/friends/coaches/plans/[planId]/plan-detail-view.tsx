"use client";

// ---------------------------------------------------------------------------
// PlanDetailView — edit one coaching plan: its title/description + visibility,
// its list of activities (add/edit/remove via the shared ActivityFormFields),
// and send the whole plan to a client.
// ---------------------------------------------------------------------------

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  addPlanActivityFormAction,
  archiveCoachPlan,
  removePlanActivity,
  sendCoachPlanOffer,
  updateCoachPlan,
  updatePlanActivityFormAction,
  type CoachPlanActivity,
  type CoachPlanDetail,
  type CoachingParty,
} from "@/app/actions/coaches";
import {
  ActivityFormFields,
  type ActivityFormInitial,
} from "@/app/_components/activity-form-fields";
import { summarizeRhythm } from "@/lib/domain/rhythm-summary";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";
import { PendingLink } from "@/app/_components/pending-link";

export function PlanDetailView({
  plan,
  clients,
}: {
  plan: CoachPlanDetail;
  clients: CoachingParty[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CoachPlanActivity | null>(null);
  const [sending, setSending] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <main className="mx-auto flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-white p-4 dark:bg-zinc-950">
      <PendingLink
        href="/friends/coaches/apply"
        className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
      >
        ← Coach profile
      </PendingLink>

      <PlanHeader plan={plan} />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
            Activities ({plan.activities.length})
          </h2>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            + Add activity
          </button>
        </div>
        {plan.activities.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-500 dark:border-zinc-700">
            No activities yet. Add the activities that make up this plan.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {plan.activities.map((a) => (
              <li
                key={a.id}
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
                    onClick={() => setEditing(a)}
                    className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Edit
                  </button>
                  <RemoveActivityButton
                    activityId={a.id}
                    name={a.name}
                    onDone={() => router.refresh()}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setSending(true)}
          disabled={plan.activities.length === 0}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Send to client
        </button>
      </div>

      {(creating || editing) && (
        <PlanActivityFormModal
          planId={plan.id}
          existing={editing}
          todayStr={todayStr}
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

      {sending && (
        <SendPlanModal
          planId={plan.id}
          planTitle={plan.title}
          clients={clients}
          todayStr={todayStr}
          onClose={() => setSending(false)}
          onSent={() => {
            setSending(false);
            router.refresh();
          }}
        />
      )}
    </main>
  );
}

function PlanHeader({ plan }: { plan: CoachPlanDetail }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(plan.title);
  const [description, setDescription] = useState(plan.description ?? "");
  const [visibility, setVisibility] = useState(plan.visibility);

  const inputCls =
    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateCoachPlan(plan.id, { title, description, visibility });
      if ("error" in res) setError(res.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (!editing) {
    return (
      <header className="flex flex-col gap-1 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{plan.title}</h1>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Edit
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          {plan.visibility === "public"
            ? "Public — visible on your profile for previews"
            : "Private — only sent clients see it"}
        </p>
        {plan.description && (
          <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">
            {plan.description}
          </p>
        )}
      </header>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-800">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={120}
        className={inputCls}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        placeholder="Plan description / notes"
        className={inputCls}
      />
      <label className="flex items-center justify-between gap-2 text-sm">
        <span className="text-xs text-zinc-500">Visibility</span>
        <select
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as "private" | "public")}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="private">Private</option>
          <option value="public">Public (profile preview)</option>
        </select>
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function RemoveActivityButton({
  activityId,
  name,
  onDone,
}: {
  activityId: string;
  name: string;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (!window.confirm(`Remove "${name}" from this plan?`)) return;
        startTransition(async () => {
          const res = await removePlanActivity(activityId);
          if (!("error" in res)) onDone();
        });
      }}
      className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
    >
      Remove
    </button>
  );
}

function PlanActivityFormModal({
  planId,
  existing,
  todayStr,
  onClose,
  onSaved,
}: {
  planId: string;
  existing: CoachPlanActivity | null;
  todayStr: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  useBodyScrollLock();
  const boundAction = existing
    ? updatePlanActivityFormAction.bind(null, existing.id)
    : addPlanActivityFormAction.bind(null, planId);
  const [state, formAction, isPending] = useActionState(boundAction, null);

  useEffect(() => {
    if (state && "ok" in state) onSaved();
  }, [state, onSaved]);

  const initialValues: ActivityFormInitial = {
    name: existing?.name ?? "",
    notes: existing?.notes ?? null,
    rhythm: existing?.rhythm ?? { type: "single" },
    priority: 2,
    scheduled_times: existing?.scheduledTimes ?? [],
    scheduled_end_times: existing?.scheduledEndTimes ?? [],
    default_skill_tags: existing?.defaultSkillTags ?? [],
    start_date: todayStr,
    end_date: null,
    reminders: [] as unknown as ActivityFormInitial["reminders"],
    track_on_grid: false,
    rollover_missed_days: false,
    rollover_change_rhythm: false,
    auto_archive: false,
    pinned: false,
    auto_resolve: false,
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-zinc-950">
      <form
        action={formAction}
        className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col gap-3 overflow-y-auto p-6"
      >
        <button
          type="button"
          onClick={onClose}
          className="self-start text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Back
        </button>
        <h2 className="text-2xl font-semibold tracking-tight">
          {existing ? "Edit activity" : "Add activity"}
        </h2>
        <ActivityFormFields
          initialValues={initialValues}
          tagMap={{}}
          showPriority={false}
          showStreaks={false}
          showPinned={false}
          showReminders={false}
          showRollover={false}
          showCompletionMode={false}
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
            {isPending ? "Saving…" : existing ? "Save activity" : "Add activity"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SendPlanModal({
  planId,
  planTitle,
  clients,
  todayStr,
  onClose,
  onSent,
}: {
  planId: string;
  planTitle: string;
  clients: CoachingParty[];
  todayStr: string;
  onClose: () => void;
  onSent: () => void;
}) {
  useBodyScrollLock();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState(clients[0]?.otherUserId ?? "");
  const [startDate, setStartDate] = useState(todayStr);

  function send() {
    setError(null);
    if (!clientId) {
      setError("Pick a client.");
      return;
    }
    startTransition(async () => {
      const res = await sendCoachPlanOffer({ planId, clientUserId: clientId, startDate });
      if ("error" in res) setError(res.error);
      else onSent();
    });
  }

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
          <h2 className="text-lg font-semibold tracking-tight">
            Send “{planTitle}”
          </h2>
          <p className="text-xs text-zinc-500">
            The client accepts to add every activity to their calendar.
          </p>
        </div>
        {clients.length === 0 ? (
          <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            No active clients yet. A client who messages you from your coach
            profile becomes available here.
          </p>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-zinc-500">Client</span>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {clients.map((c) => (
                  <option key={c.otherUserId} value={c.otherUserId}>
                    {c.displayName ?? (c.username ? `@${c.username}` : "Client")}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-zinc-500">Start date</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          </>
        )}
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
            onClick={send}
            disabled={isPending || clients.length === 0}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? "Sending…" : "Send plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
