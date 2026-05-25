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
  onCopy,
  onClose,
}: {
  share: SharedActivity;
  friendId: string;
  tagMap: TagMap;
  watch: { notifyEach: boolean; notifyDaily: boolean; notifyWeekly: boolean };
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
          <dl className="flex flex-col gap-2 text-sm">
            <DetailRow label="Rhythm">
              {summarizeRhythm(share.rhythm, share.scheduledTimes)}
            </DetailRow>
            {timesLine && <DetailRow label="Time">{timesLine}</DetailRow>}
            <DetailRow label={isSingle ? "Scheduled" : "Range"}>
              {summarizeDateRange(share.startDate, share.endDate, isSingle)}
            </DetailRow>
            <DetailRow label="Priority">
              {PRIORITY_LABEL[share.priority] ?? "Medium"}
            </DetailRow>
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

        {/* Action bar — Reply / Reminders / Copy. View-only otherwise. */}
        <div className="flex flex-wrap gap-2 border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <ReplyButton
            friendId={friendId}
            activityId={share.activityId}
            activityName={share.name}
          />
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
