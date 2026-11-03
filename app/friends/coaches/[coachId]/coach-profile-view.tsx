"use client";

// ---------------------------------------------------------------------------
// CoachProfileView — the full public coach profile: header (photo / bio /
// price / rating), all reviews, and the coach's public plans (expandable to
// preview their activities). Engaging the coach uses the same client-
// disclaimer gate as the Find-a-Coach directory.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  startCoaching,
  type CoachDirectoryEntry,
  type CoachPlanDetail,
  type CoachReview,
} from "@/app/actions/coaches";
import { TermsModal } from "@/app/_components/agreement-prompts";
import { COACHING_CLIENT_DISCLAIMER, needsAck } from "@/lib/domain/agreements";
import { summarizeRhythm } from "@/lib/domain/rhythm-summary";

import { PendingLink } from "@/app/_components/pending-link";
import { initials, priceLabel } from "../coach-ui";

export function CoachProfileView({
  coach,
  reviews,
  plans,
  engaged,
  acks,
}: {
  coach: CoachDirectoryEntry;
  reviews: CoachReview[];
  plans: CoachPlanDetail[];
  engaged: boolean;
  acks: Record<string, number>;
}) {
  const router = useRouter();
  const name =
    coach.displayName ?? (coach.username ? `@${coach.username}` : "Coach");
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(
    !needsAck(acks, COACHING_CLIENT_DISCLAIMER)
  );
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [, startEngage] = useTransition();

  function doEngage() {
    startEngage(async () => {
      const res = await startCoaching(coach.userId);
      if (!("error" in res))
        router.push(`/friends/coaches/${coach.userId}/chat`);
    });
  }
  function engage() {
    if (!disclaimerAccepted) setShowDisclaimer(true);
    else doEngage();
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto bg-white p-4 dark:bg-zinc-950">
      <header className="flex shrink-0 flex-col gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <PendingLink
          href="/friends/coaches/find"
          className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Find a Coach
        </PendingLink>
      </header>

      {showDisclaimer && (
        <TermsModal
          agreement={COACHING_CLIENT_DISCLAIMER}
          onCancel={() => setShowDisclaimer(false)}
          onAccept={() => {
            setShowDisclaimer(false);
            setDisclaimerAccepted(true);
            doEngage();
          }}
        />
      )}

      {/* Profile header */}
      <section className="flex items-start gap-4">
        {coach.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coach.photoUrl}
            alt=""
            className="h-20 w-20 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-lg font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {initials(coach.displayName, coach.username)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {name}
          </h1>
          <p className="mt-0.5 text-sm font-medium text-zinc-600 dark:text-zinc-400">
            {priceLabel(coach.priceAmount, coach.priceUnit)}
          </p>
          <p className="mt-0.5 text-sm text-amber-600 dark:text-amber-400">
            {coach.ratingCount > 0
              ? `★ ${coach.ratingAvg} (${coach.ratingCount} review${
                  coach.ratingCount === 1 ? "" : "s"
                })`
              : "No reviews yet"}
          </p>
          <button
            type="button"
            onClick={engage}
            className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {engaged ? "Message" : "Message coach"}
          </button>
        </div>
      </section>

      {coach.bio && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">About</h2>
          <p className="whitespace-pre-wrap break-words text-sm text-zinc-600 dark:text-zinc-400">
            {coach.bio}
          </p>
        </section>
      )}

      {/* Public plans — free previews the coach chose to share */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Plans{plans.length > 0 ? ` (${plans.length})` : ""}
        </h2>
        {plans.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-500 dark:border-zinc-700">
            This coach hasn’t shared any public plans yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {plans.map((p) => (
              <PlanPreview key={p.id} plan={p} />
            ))}
          </ul>
        )}
      </section>

      {/* Reviews — the full list */}
      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Reviews{reviews.length > 0 ? ` (${reviews.length})` : ""}
        </h2>
        {reviews.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-500 dark:border-zinc-700">
            No reviews yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {reviews.map((r, i) => (
              <li
                key={i}
                className="rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-900"
              >
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  {"★".repeat(r.rating)}
                  {"☆".repeat(5 - r.rating)}{" "}
                  <span className="font-normal text-zinc-500">
                    {r.reviewerName}
                  </span>
                </p>
                {r.body && (
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-zinc-600 dark:text-zinc-400">
                    {r.body}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function PlanPreview({ plan }: { plan: CoachPlanDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-2 text-left"
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{plan.title}</p>
          {plan.description && (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-400">
              {plan.description}
            </p>
          )}
        </div>
        <span className="shrink-0 text-xs font-medium text-zinc-500">
          {open ? "Hide" : `${plan.activities.length} ${plan.activities.length === 1 ? "activity" : "activities"}`}
        </span>
      </button>
      {open && plan.activities.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          {plan.activities.map((a) => (
            <li key={a.id} className="text-xs">
              <span className="font-medium">{a.name}</span>
              <span className="text-zinc-500">
                {" "}
                · {summarizeRhythm(a.rhythm, a.scheduledTimes)}
              </span>
              {a.notes && (
                <p className="whitespace-pre-wrap break-words text-zinc-500">
                  {a.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
