"use client";

// ---------------------------------------------------------------------------
// SharedActivityModal — read-only detail for one of a friend's shared
// rhythms, openable from ANY shared view (Total card, Calendar day/week,
// Grid). Shows the full details (including notes, which the compact cards
// don't) and the same actions: Reply (quote into chat), Reminders, and
// Copy to my schedule. View-only — no editing a friend's activity.
// ---------------------------------------------------------------------------

import { useEffect } from "react";

import type { SharedActivity } from "@/app/actions/sharing";
import {
  summarizeDateRange,
  summarizeRhythm,
  summarizeScheduledTimes,
} from "@/lib/domain/rhythm-summary";
import type { TagMap } from "@/lib/domain/tags";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

import { TagChipList } from "@/app/_components/tag-chip";

import type { Occurrence } from "./shared-data";
import { RemindersButton } from "./reminders-button";
import { ReplyButton } from "./reply-button";

const PRIORITY_LABEL: Record<number, string> = {
  1: "High",
  2: "Medium",
  3: "Low",
};

export function SharedActivityModal({
  share,
  friendId,
  tagMap,
  watch,
  occurrence,
  onCopy,
  onClose,
}: {
  share: SharedActivity;
  friendId: string;
  tagMap: TagMap;
  watch: { notifyEach: boolean; notifyDaily: boolean; notifyWeekly: boolean };
  /** The specific occurrence clicked (date + status), or null for a
   *  rhythm-level open (e.g. from the Total list). Reply quotes the
   *  occurrence when present. */
  occurrence: Occurrence | null;
  onCopy: (s: SharedActivity) => void;
  onClose: () => void;
}) {
  const isSingle = share.rhythm.type === "single";
  const archived = share.archivedAt !== null;
  const timesLine = summarizeScheduledTimes(share.scheduledTimes);

  useBodyScrollLock();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shared-activity-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="min-w-0">
            <h2
              id="shared-activity-title"
              className="break-words text-xl font-semibold tracking-tight"
            >
              {share.name}
            </h2>
            {archived && (
              <span className="mt-1 inline-block rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                Archived
              </span>
            )}
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

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* The specific occurrence the user opened (date + state). */}
          {occurrence && (
            <div className="mb-4 flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                    This occurrence
                  </p>
                  <p className="truncate text-sm font-medium">
                    {formatDmy(occurrence.scheduledFor)}
                  </p>
                </div>
                <StatusBadge label={occurrence.statusLabel} />
              </div>
              {/* Owner's reflection on this occurrence (migration 0020).
                  Read-only on the friend side — quoted so it visually
                  reads as the owner's voice. */}
              {occurrence.comment && (
                <p className="whitespace-pre-wrap break-words rounded-md bg-white px-2 py-1.5 text-xs italic text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                  “{occurrence.comment}”
                </p>
              )}
            </div>
          )}

          <dl className="flex flex-col gap-2 text-sm">
            <DetailRow label="Rhythm">
              {summarizeRhythm(share.rhythm, share.scheduledTimes)}
            </DetailRow>
            {timesLine && <DetailRow label="Time">{timesLine}</DetailRow>}
            <DetailRow label={isSingle ? "Scheduled" : "Range"}>
              {summarizeDateRange(share.startDate, share.endDate, isSingle)}
            </DetailRow>
            {/* Priority row hidden per user spec (soft removal). */}
          </dl>

          <div className="mt-5">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Notes
            </h3>
            {share.notes ? (
              <p className="whitespace-pre-wrap break-words text-sm">
                {share.notes}
              </p>
            ) : (
              <p className="text-sm text-zinc-500">None</p>
            )}
          </div>

          {share.defaultSkillTags.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Tags
              </h3>
              <TagChipList
                names={share.defaultSkillTags}
                tags={tagMap}
                size="sm"
              />
            </div>
          )}
        </div>

        {/* Action bar — Reply (quotes THIS occurrence) / Reminders / Copy. */}
        <div className="flex flex-wrap gap-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          {occurrence && (
            <ReplyButton
              friendId={friendId}
              activityId={share.activityId}
              activityName={share.name}
              scheduledFor={occurrence.scheduledFor}
              statusLabel={occurrence.statusLabel}
            />
          )}
          {!archived && share.shareProgress && (
            <RemindersButton
              activityId={share.activityId}
              activityName={share.name}
              initial={watch}
            />
          )}
          <button
            type="button"
            onClick={() => {
              onClose();
              onCopy(share);
            }}
            className="ml-auto touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Copy to my schedule
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="w-28 shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  );
}

function StatusBadge({ label }: { label: string }) {
  const cls =
    label === "Completed"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      : label === "Missed"
        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
        : label === "Unlabeled"
          ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400";
  return (
    <span
      className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

function formatDmy(yyyyMmDd: string): string {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
