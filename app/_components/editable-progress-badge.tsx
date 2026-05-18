"use client";

// ---------------------------------------------------------------------------
// Editable X/Y badge for frequency rhythms.
//
// Click → input appears → type a number → Enter or blur to save.
// Escape cancels.
//
// Calls setInstanceProgress to add or remove completions as needed.
// Useful for "I miss-clicked +1" undo and "I did 3 of these at end of
// day, mark them all" mass-fill flows.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useTransition } from "react";

import { setInstanceProgress } from "@/app/actions/activities";

export function EditableProgressBadge({
  instanceId,
  current,
  target,
  scheduledFor,
  todayStr,
  className,
}: {
  instanceId: string;
  current: number;
  target: number;
  /** YYYY-MM-DD — used to confirm before increasing a future instance. */
  scheduledFor: string;
  todayStr: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(current));
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // When `current` changes from above (e.g., server revalidated after a
  // setInstanceProgress call), sync the displayed draft so the badge
  // follows the truth on the next render. Done as derived state during
  // render rather than in an effect — React 19 lints
  // `useEffect(() => setX(prop), [prop])` because it causes a cascading
  // render. The `lastSyncedCurrent` snapshot lets us notice the change
  // exactly once. We skip the resync while the user is mid-edit so we
  // don't blow away what they typed.
  const [lastSyncedCurrent, setLastSyncedCurrent] = useState(current);
  if (current !== lastSyncedCurrent) {
    setLastSyncedCurrent(current);
    if (!editing) setDraft(String(current));
  }

  // Auto-focus + select when entering edit mode.
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  function commit() {
    setEditing(false);
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n)) {
      setDraft(String(current));
      return;
    }
    const clamped = Math.max(0, Math.min(target, n));
    if (clamped === current) return;
    // Same confirmation as the Complete button for future-dated rows. We
    // only warn when *increasing* — decreasing is always allowed (it's an
    // undo, can't accidentally do work in the future).
    if (clamped > current && scheduledFor > todayStr) {
      const ok = window.confirm(
        `This is scheduled for ${scheduledFor}, in the future. Mark progress anyway?`
      );
      if (!ok) {
        setDraft(String(current));
        return;
      }
    }
    startTransition(async () => {
      await setInstanceProgress(instanceId, clamped);
    });
  }

  if (editing) {
    return (
      <span className={`inline-flex items-center gap-0.5 ${className ?? ""}`}>
        <input
          ref={inputRef}
          type="number"
          min={0}
          max={target}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              setDraft(String(current));
              setEditing(false);
            }
          }}
          className="w-10 rounded border border-zinc-400 bg-white px-1 text-center text-xs tabular-nums dark:border-zinc-500 dark:bg-zinc-900"
        />
        <span className="text-xs text-zinc-500">/{target}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(String(current));
        setEditing(true);
      }}
      disabled={isPending}
      title="Click to edit progress"
      aria-label={`${current} of ${target} done — click to edit`}
      className={className}
    >
      {isPending ? "…" : `${current}/${target}`}
    </button>
  );
}
