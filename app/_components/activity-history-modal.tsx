"use client";

// ---------------------------------------------------------------------------
// ActivityHistoryModal — per-activity history viewer.
//
// Opens from:
//   - The ActivityModal's bottom action bar ("History" button in
//     details mode), so it works for every activity reachable from
//     Day / Week / Month / Grid.
//   - The /activities Archive cards, so an archived activity's full
//     history is one click away.
//
// On mount it calls fetchActivityHistory(activityId) (server action)
// and renders:
//   - Top: aggregate stats (total / completed / missed / unlabeled /
//          completion rate / current + best streak).
//   - Bottom: every instance, newest-first, with a colored status dot
//             + the date.
//
// Modal-only / lazy-fetch per user preference: the archive page can
// stay light, the Day/Grid views don't pre-fetch history they don't
// need.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";

import {
  fetchActivityHistory,
  type HistoryPayload,
} from "@/app/actions/history";

type Status = "pending" | "completed" | "missed";

export function ActivityHistoryModal({
  activityId,
  activityName,
  onClose,
}: {
  activityId: string;
  /** Shown in the modal header while the fetch is in flight (so the
   *  user has context). We don't wait for the server payload to know
   *  the name. */
  activityName: string;
  onClose: () => void;
}) {
  const [payload, setPayload] = useState<HistoryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Body scroll-lock.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Fetch on mount. This is the canonical "fetch external data into
  // local state" pattern — the React 19 set-state-in-effect lint
  // (which targets cascading-render bugs) does not flag async fetches
  // resolving into setState inside the .then() handler.
  //
  // .catch() defends against the case where the server action throws
  // (e.g., session expired mid-request) — without it, the modal would
  // silently hang on "Loading history…" forever. console.error so
  // the actual error shows up in DevTools for debugging.
  useEffect(() => {
    let alive = true;
    fetchActivityHistory(activityId)
      .then((result) => {
        if (!alive) return;
        if ("error" in result) setError(result.error);
        else setPayload(result);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const msg =
          err instanceof Error ? err.message : "Failed to load history.";
        console.error("fetchActivityHistory failed:", err);
        setError(msg);
      });
    return () => {
      alive = false;
    };
  }, [activityId]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              History
            </p>
            <h2
              id="history-modal-title"
              className="break-words text-xl font-semibold tracking-tight"
            >
              {payload?.activity.name ?? activityName}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p
              role="alert"
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          ) : !payload ? (
            <p className="text-sm text-zinc-500">Loading history…</p>
          ) : (
            <>
              <StatsGrid stats={payload.stats} />
              <InstanceLog instances={payload.instances} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StatsGrid({ stats }: { stats: HistoryPayload["stats"] }) {
  // 7 tiles — past-only. We dropped "Scheduled (future)" alongside
  // the timeline becoming past-only; mixing it in here would be
  // misleading.
  const items: Array<{
    label: string;
    value: string;
    tone: "default" | "good" | "bad" | "warn";
  }> = [
    {
      label: "Completed",
      value: String(stats.completed),
      tone: "good",
    },
    {
      label: "Missed",
      value: String(stats.missed),
      tone: "bad",
    },
    {
      label: "Unlabeled",
      value: String(stats.unlabeled),
      tone: "warn",
    },
    {
      label: "Completion rate",
      value:
        stats.completion_rate === null
          ? "—"
          : `${stats.completion_rate}%`,
      tone: "default",
    },
    {
      label: "Current streak",
      value: `🔥 ${stats.current_streak}`,
      tone: "default",
    },
    {
      label: "Best streak",
      value: `🏆 ${stats.best_streak}`,
      tone: "default",
    },
    {
      label: "Total past",
      value: String(stats.total),
      tone: "default",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {it.label}
          </div>
          <div
            className={`text-base font-semibold ${
              it.tone === "good"
                ? "text-emerald-600 dark:text-emerald-400"
                : it.tone === "bad"
                  ? "text-red-600 dark:text-red-400"
                  : it.tone === "warn"
                    ? "text-amber-600 dark:text-amber-400"
                    : ""
            }`}
          >
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

function InstanceLog({
  instances,
}: {
  instances: HistoryPayload["instances"];
}) {
  if (instances.length === 0) {
    return (
      <p className="mt-6 rounded-md border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-500 dark:border-zinc-700">
        No instances yet.
      </p>
    );
  }

  return (
    <div className="mt-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Timeline (newest first)
      </p>
      <ul className="flex flex-col gap-1">
        {instances.map((inst) => {
          // For pending past-due rows ("unlabeled") the visible status
          // overrides the raw "pending" label so the user sees a clear
          // distinction between "still to come" and "needs a verdict."
          const label = inst.unlabeled
            ? "Unlabeled"
            : inst.status === "completed"
              ? "Completed"
              : inst.status === "missed"
                ? "Missed"
                : "Scheduled";
          return (
            <li
              key={inst.id}
              className="flex items-center gap-2 rounded-md border border-zinc-100 bg-white px-2 py-1.5 text-xs dark:border-zinc-900 dark:bg-zinc-950"
            >
              <StatusDot status={inst.status} unlabeled={inst.unlabeled} />
              <span className="flex-1 tabular-nums text-zinc-700 dark:text-zinc-300">
                {formatDmy(inst.scheduled_for)}
              </span>
              <span
                className={`text-[10px] font-medium uppercase tracking-wide ${
                  inst.status === "completed"
                    ? "text-emerald-700 dark:text-emerald-300"
                    : inst.status === "missed"
                      ? "text-red-700 dark:text-red-300"
                      : inst.unlabeled
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-zinc-500"
                }`}
              >
                {label}
              </span>
              {inst.completion_count > 1 && (
                <span
                  title="Completions linked to this instance"
                  className="rounded bg-zinc-100 px-1 text-[10px] tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                >
                  ×{inst.completion_count}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusDot({
  status,
  unlabeled,
}: {
  status: Status;
  unlabeled: boolean;
}) {
  let cls: string;
  if (status === "completed") cls = "bg-emerald-500";
  else if (status === "missed") cls = "bg-red-500";
  else if (unlabeled) cls = "bg-amber-400";
  else cls = "border border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900";
  return (
    <span
      aria-hidden
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${cls}`}
    />
  );
}

function formatDmy(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
