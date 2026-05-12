"use client";

// ---------------------------------------------------------------------------
// Activity-details modal. Opened by tapping a Day-view row. Shows the
// activity in full (no truncation) with a sticky bottom action bar.
//
// Closes on: outside click, Escape, or the explicit ×.
// Action buttons optimistically close before the server round-trip.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useEffect, useTransition } from "react";

import {
  archiveActivity,
  completeInstance,
  missInstance,
} from "@/app/actions/activities";
import {
  summarizeDateRange,
  summarizeRhythm,
  summarizeScheduledTimes,
} from "@/lib/domain/rhythm-summary";

import type { DayInstance } from "./day-list";

const PRIORITY_LABEL: Record<number, string> = {
  1: "High",
  2: "Medium",
  3: "Low",
};

export function ActivityModal({
  instance,
  todayStr,
  onClose,
}: {
  instance: DayInstance;
  todayStr: string;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const activity = instance.activity;
  const isSingle = activity.rhythm.type === "single";

  // Escape closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Body scroll-lock while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function handleComplete() {
    if (instance.scheduled_for > todayStr) {
      const ok = window.confirm(
        `This is scheduled for ${instance.scheduled_for}, in the future. Mark complete anyway?`
      );
      if (!ok) return;
    }
    onClose();
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
            {activity.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        {/* Scrollable body */}
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
              <div className="flex flex-wrap gap-1.5">
                {activity.default_skill_tags.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sticky bottom actions */}
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
          <SecondaryLink
            label="Edit activity"
            href={`/activities/${activity.id}/edit?section=activity`}
          />
          <SecondaryLink
            label="Edit rhythm"
            href={`/activities/${activity.id}/edit?section=rhythm`}
          />
          <Danger
            label="Drop and save"
            disabled={isPending}
            onClick={handleDropAndSave}
          />
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
      className="flex-1 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
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
      className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      {label}
    </button>
  );
}

function SecondaryLink({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-center text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      {label}
    </Link>
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
      className="flex-1 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
    >
      {label}
    </button>
  );
}
