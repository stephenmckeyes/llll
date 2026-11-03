"use client";

// ---------------------------------------------------------------------------
// Coach plans UI (migration 0081):
//   * CoachOffersSection — a client's incoming PLAN offers (a plan + all its
//     activities), with Accept (materializes every activity) / Decline.
//   * CoachPlansSection — the coach's library of plans (each a title +
//     description + multiple activities). Create here; each plan opens its own
//     page for editing its activities + sending it.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  acceptCoachPlanOffer,
  createCoachPlan,
  declineCoachPlanOffer,
  type CoachPlanOffer,
  type CoachPlanSummary,
} from "@/app/actions/coaches";
import { summarizeRhythm } from "@/lib/domain/rhythm-summary";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";
import { PendingLink } from "@/app/_components/pending-link";

function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// --- Offers (client side) --------------------------------------------------

export function CoachOffersSection({ offers }: { offers: CoachPlanOffer[] }) {
  if (offers.length === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
        Plans from your coaches ({offers.length})
      </h3>
      <ul className="flex flex-col gap-2">
        {offers.map((o) => (
          <OfferRow key={o.id} offer={o} />
        ))}
      </ul>
    </section>
  );
}

function OfferRow({ offer }: { offer: CoachPlanOffer }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function act(kind: "accept" | "decline") {
    setError(null);
    startTransition(async () => {
      const res =
        kind === "accept"
          ? await acceptCoachPlanOffer(offer.id)
          : await declineCoachPlanOffer(offer.id);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{offer.planTitle}</p>
        <p className="text-xs text-zinc-500">
          from {offer.coachName} · {offer.activities.length} activit
          {offer.activities.length === 1 ? "y" : "ies"} · starts{" "}
          {fmtDate(offer.startDate)}
        </p>
        {offer.planDescription && (
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-400">
            {offer.planDescription}
          </p>
        )}
        {offer.activities.length > 0 && (
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {offer.activities.map((a, i) => (
              <li key={i} className="text-xs text-zinc-600 dark:text-zinc-400">
                • {a.name}{" "}
                <span className="text-zinc-400">
                  ({summarizeRhythm(a.rhythm, a.scheduledTimes)})
                </span>
              </li>
            ))}
          </ul>
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

// --- Plan library (coach side) ---------------------------------------------

export function CoachPlansSection({ plans }: { plans: CoachPlanSummary[] }) {
  const [creating, setCreating] = useState(false);

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
        A plan is a titled set of activities with its own notes. Open one to add
        activities and send it to a client.
      </p>

      {plans.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-500 dark:border-zinc-700">
          No plans yet. Create one to start building.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {plans.map((p) => (
            <li key={p.id}>
              <PendingLink
                href={`/friends/coaches/plans/${p.id}`}
                className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.title}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {p.activityCount} activit
                    {p.activityCount === 1 ? "y" : "ies"}
                    {p.visibility === "public" ? " · public" : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-zinc-400">→</span>
              </PendingLink>
            </li>
          ))}
        </ul>
      )}

      {creating && <NewPlanModal onClose={() => setCreating(false)} />}
    </section>
  );
}

function NewPlanModal({ onClose }: { onClose: () => void }) {
  useBodyScrollLock();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const inputCls =
    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  function create() {
    setError(null);
    if (!title.trim()) {
      setError("Give the plan a title.");
      return;
    }
    startTransition(async () => {
      const res = await createCoachPlan(title, description);
      if ("error" in res) setError(res.error);
      else router.push(`/friends/coaches/plans/${res.id}`);
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
        <h2 className="text-lg font-semibold tracking-tight">New plan</h2>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Plan title (e.g. 8-Week Beginner Strength)"
          maxLength={120}
          className={inputCls}
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What this plan is, who it's for, how to use it (optional)"
          className={inputCls}
        />
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
            onClick={create}
            disabled={isPending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? "Creating…" : "Create & open"}
          </button>
        </div>
      </div>
    </div>
  );
}
