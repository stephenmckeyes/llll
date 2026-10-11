"use client";

// ---------------------------------------------------------------------------
// Coach activity cache UI (migration 0074):
//   * CoachOffersSection — a client's incoming plan offers (Accept / Decline).
//   * CoachTemplatesSection — a coach's template library (New / Edit / Duplicate
//     / Archive / Send to a client), reusing the shared ActivityFormFields.
// ---------------------------------------------------------------------------

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  acceptCoachOffer,
  archiveCoachTemplate,
  createCoachTemplateFormAction,
  declineCoachOffer,
  duplicateCoachTemplate,
  sendCoachOffer,
  updateCoachTemplateFormAction,
  type CoachOffer,
  type CoachTemplate,
  type CoachingParty,
} from "@/app/actions/coaches";
import {
  ActivityFormFields,
  type ActivityFormInitial,
} from "@/app/_components/activity-form-fields";
import { summarizeRhythm } from "@/lib/domain/rhythm-summary";
import type { TagMap } from "@/lib/domain/tags";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// --- Offers (client side) --------------------------------------------------

export function CoachOffersSection({ offers }: { offers: CoachOffer[] }) {
  if (offers.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
        Plans from your coaches ({offers.length})
      </h2>
      <ul className="flex flex-col gap-2">
        {offers.map((o) => (
          <OfferRow key={o.id} offer={o} />
        ))}
      </ul>
    </section>
  );
}

function OfferRow({ offer }: { offer: CoachOffer }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(kind: "accept" | "decline") {
    setError(null);
    startTransition(async () => {
      const res =
        kind === "accept"
          ? await acceptCoachOffer(offer.id)
          : await declineCoachOffer(offer.id);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{offer.name}</p>
        <p className="text-xs text-zinc-500">
          from {offer.coachName} · {summarizeRhythm(offer.rhythm, offer.scheduledTimes)} · starts {fmtDate(offer.startDate)}
        </p>
        {offer.notes && (
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-400">
            {offer.notes}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => act("accept")}
          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Add to my calendar
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => act("decline")}
          className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Decline
        </button>
      </div>
    </li>
  );
}

// --- Templates (coach side) ------------------------------------------------

export function CoachTemplatesSection({
  templates,
  clients,
  tagMap,
  todayStr,
}: {
  templates: CoachTemplate[];
  clients: CoachingParty[];
  tagMap: TagMap;
  todayStr: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<CoachTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState<CoachTemplate | null>(null);

  return (
    <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          Your coaching plans
        </h2>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          + New plan
        </button>
      </div>
      <p className="text-xs text-zinc-500">
        Reusable activity templates you can send to clients. Duplicate one to
        tweak it for a specific person.
      </p>

      {templates.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-500 dark:border-zinc-700">
          No plans yet. Create one to send to your clients.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {templates.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-1.5 dark:border-zinc-800"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{t.name}</p>
                <p className="truncate text-xs text-zinc-500">
                  {summarizeRhythm(t.rhythm, t.scheduledTimes)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => setSending(t)}
                  className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Send
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(t)}
                  className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Edit
                </button>
                <TemplateIconButton
                  label="Duplicate"
                  onRun={() => duplicateCoachTemplate(t.id)}
                  onDone={() => router.refresh()}
                />
                <TemplateIconButton
                  label="Archive"
                  danger
                  confirm={`Archive "${t.name}"?`}
                  onRun={() => archiveCoachTemplate(t.id)}
                  onDone={() => router.refresh()}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <TemplateFormModal
          tagMap={tagMap}
          todayStr={todayStr}
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

      {sending && (
        <SendOfferModal
          template={sending}
          clients={clients.filter((c) => c.status === "active")}
          todayStr={todayStr}
          onClose={() => setSending(null)}
          onSent={() => {
            setSending(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function TemplateIconButton({
  label,
  danger,
  confirm,
  onRun,
  onDone,
}: {
  label: string;
  danger?: boolean;
  confirm?: string;
  onRun: () => Promise<{ error: string } | { ok: true }>;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        startTransition(async () => {
          const res = await onRun();
          if (!("error" in res)) onDone();
        });
      }}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
        danger
          ? "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );
}

function TemplateFormModal({
  tagMap,
  todayStr,
  existing,
  onClose,
  onSaved,
}: {
  tagMap: TagMap;
  todayStr: string;
  existing: CoachTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  useBodyScrollLock();
  const boundAction = existing
    ? updateCoachTemplateFormAction.bind(null, existing.id)
    : createCoachTemplateFormAction;
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
          {existing ? "Edit plan" : "New plan"}
        </h2>
        {/* Templates are just the rhythm shape: name, rhythm, times, tags.
            Dates/streaks/pinned/rollover/reminders/completion don't apply. */}
        <ActivityFormFields
          initialValues={initialValues}
          tagMap={tagMap}
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
            {isPending ? "Saving…" : existing ? "Save plan" : "Create plan"}
          </button>
        </div>
      </form>
    </div>
  );
}

function SendOfferModal({
  template,
  clients,
  todayStr,
  onClose,
  onSent,
}: {
  template: CoachTemplate;
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
      const res = await sendCoachOffer({
        templateId: template.id,
        clientUserId: clientId,
        startDate,
      });
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
            Send “{template.name}”
          </h2>
          <p className="text-xs text-zinc-500">
            The client accepts to add it to their calendar.
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
              <span className="text-xs font-medium text-zinc-500">
                Start date
              </span>
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
