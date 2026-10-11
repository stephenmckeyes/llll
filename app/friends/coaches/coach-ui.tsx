"use client";

// ---------------------------------------------------------------------------
// Shared Coaches UI bits used by both the main tab and the dedicated
// Find-a-Coach / Apply pages.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import {
  getCoachReviews,
  type CoachDirectoryEntry,
  type CoachReview,
} from "@/app/actions/coaches";

export function priceLabel(
  amount: number | null,
  unit: "day" | "week" | null
): string {
  if (amount == null || unit == null) return "Price on request";
  const n = Number(amount);
  const money = Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
  return `${money} / ${unit}`;
}

export function initials(name: string | null, username: string | null): string {
  const base = (name ?? username ?? "?").trim();
  const parts = base.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function CoachStatusBadge({
  status,
}: {
  status: "pending" | "verified" | "rejected";
}) {
  const cls =
    status === "verified"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      : status === "rejected"
        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
        : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  const label =
    status === "verified"
      ? "Verified"
      : status === "rejected"
        ? "Not approved"
        : "Pending review";
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

export function CoachCard({
  coach,
  engaged,
  onMessage,
}: {
  coach: CoachDirectoryEntry;
  engaged: boolean;
  onMessage: () => void;
}) {
  const name = coach.displayName ?? (coach.username ? `@${coach.username}` : "Coach");
  return (
    <li className="flex items-start gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      {coach.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coach.photoUrl}
          alt=""
          className="h-14 w-14 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {initials(coach.displayName, coach.username)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold">{name}</p>
          <span className="shrink-0 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {priceLabel(coach.priceAmount, coach.priceUnit)}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
          {coach.ratingCount > 0
            ? `★ ${coach.ratingAvg} (${coach.ratingCount})`
            : "No reviews yet"}
        </p>
        {coach.bio && (
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-400">
            {coach.bio}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onMessage}
            className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {engaged ? "Message" : "Message coach"}
          </button>
          {coach.ratingCount > 0 && <ReviewsExpander coach={coach} />}
        </div>
      </div>
    </li>
  );
}

function ReviewsExpander({ coach }: { coach: CoachDirectoryEntry }) {
  const [open, setOpen] = useState(false);
  const [reviews, setReviews] = useState<CoachReview[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (reviews === null) {
      startTransition(async () => {
        setReviews(await getCoachReviews(coach.userId));
      });
    }
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={toggle}
        className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {open ? "Hide reviews" : `See reviews (${coach.ratingCount})`}
      </button>
      {open && (
        <ul className="mt-2 flex w-full flex-col gap-1.5">
          {isPending && reviews === null ? (
            <li className="text-xs text-zinc-500">Loading…</li>
          ) : (
            (reviews ?? []).map((r, i) => (
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
            ))
          )}
        </ul>
      )}
    </div>
  );
}
