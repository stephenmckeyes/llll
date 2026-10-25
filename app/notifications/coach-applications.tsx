"use client";

// ---------------------------------------------------------------------------
// CoachApplicationsNotifications — admin-only review queue on /notifications.
// Mirrors the Coaches-tab review panel so an admin can verify/reject pending
// coach applications without hunting through the Coaches tab. The pending list
// is fetched by the admin-gated get_pending_coach_applications RPC (empty for
// non-admins), so this only renders when there's something to review.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  setCoachStatus,
  type PendingCoachApplication,
} from "@/app/actions/coaches";

function priceLabel(amount: number | null, unit: "day" | "week" | null): string {
  if (amount == null || unit == null) return "Price on request";
  const n = Number(amount);
  const money = Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
  return `${money} / ${unit}`;
}

export function CoachApplicationsNotifications({
  pending,
}: {
  pending: PendingCoachApplication[];
}) {
  if (pending.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Coach applications ({pending.length})
      </h2>
      <ul className="flex flex-col gap-2">
        {pending.map((a) => (
          <Row key={a.userId} app={a} />
        ))}
      </ul>
    </section>
  );
}

function Row({ app }: { app: PendingCoachApplication }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const name = app.displayName ?? (app.username ? `@${app.username}` : "Applicant");

  function decide(status: "verified" | "rejected") {
    setError(null);
    startTransition(async () => {
      const res = await setCoachStatus(app.userId, status);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="text-xs text-zinc-500">
          {priceLabel(app.priceAmount, app.priceUnit)}
        </p>
        {app.bio && (
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-400">
            {app.bio}
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
          onClick={() => decide("verified")}
          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Verify
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => decide("rejected")}
          className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          Reject
        </button>
      </div>
    </li>
  );
}
