"use client";

// ---------------------------------------------------------------------------
// Sticky bottom action bar on /activities/[id]. Floats above content so
// it's always reachable even when the details body needs to scroll.
//
// Buttons:
//   Complete       — log a completion (warns if scheduled in the future)
//   Skip           — mark this occurrence skipped (no completion logged)
//   Edit activity  — navigate to /activities/[id]/edit?section=activity
//   Edit rhythm    — navigate to /activities/[id]/edit?section=rhythm
//   Drop and save  — archive (soft-delete; survives in Manage > Archived)
//
// Complete + Skip require an instance ID — if the user landed here without
// one, those buttons are hidden (the user came from Manage, not from a
// specific day row).
// ---------------------------------------------------------------------------

import Link from "next/link";
import { useTransition } from "react";

import {
  archiveActivity,
  completeInstance,
  skipInstance,
} from "@/app/actions/activities";

const TODAY_STR = new Date().toISOString().slice(0, 10);

export function ActivityActions({
  activityId,
  instanceId,
  instanceScheduledFor,
  instanceStatus,
  archived,
}: {
  activityId: string;
  instanceId: string | null;
  instanceScheduledFor: string | null;
  instanceStatus: string | null;
  archived: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  const canCompleteOrSkip = instanceId && instanceStatus === "pending";

  function handleComplete() {
    if (!instanceId) return;
    if (instanceScheduledFor && instanceScheduledFor > TODAY_STR) {
      const ok = window.confirm(
        `This is scheduled for ${instanceScheduledFor}, in the future. Mark complete anyway?`
      );
      if (!ok) return;
    }
    startTransition(async () => {
      await completeInstance(instanceId);
    });
  }

  function handleSkip() {
    if (!instanceId) return;
    startTransition(async () => {
      await skipInstance(instanceId);
    });
  }

  function handleDropAndSave() {
    const ok = window.confirm(
      "Drop this activity and save its history? You can recover it from Manage → Archived."
    );
    if (!ok) return;
    startTransition(async () => {
      await archiveActivity(activityId);
    });
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="mx-auto flex max-w-xl flex-wrap gap-2 p-3">
        {canCompleteOrSkip && (
          <>
            <PrimaryButton
              label={isPending ? "…" : "Complete"}
              onClick={handleComplete}
              disabled={isPending}
            />
            <SecondaryButton
              label="Skip"
              onClick={handleSkip}
              disabled={isPending}
            />
          </>
        )}
        <SecondaryLink
          label="Edit activity"
          href={`/activities/${activityId}/edit?section=activity`}
        />
        <SecondaryLink
          label="Edit rhythm"
          href={`/activities/${activityId}/edit?section=rhythm`}
        />
        {!archived && (
          <DangerButton
            label="Drop and save"
            onClick={handleDropAndSave}
            disabled={isPending}
          />
        )}
      </div>
    </div>
  );
}

function PrimaryButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
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

function SecondaryButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
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

function DangerButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
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
