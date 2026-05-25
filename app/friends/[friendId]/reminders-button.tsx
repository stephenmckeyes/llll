"use client";

// ---------------------------------------------------------------------------
// RemindersButton + RemindersModal — set progress nudges for ONE friend's
// shared rhythm. Sits next to "Copy" on the friend's Total view.
//
// Three independent cadences:
//   - On each completion/miss
//   - End of every day
//   - End of every week
//
// Reminders show up live in your Notifications tab; this just records the
// preference via setWatch. Optimistic local state so toggles feel instant.
// ---------------------------------------------------------------------------

import { useEffect, useState, useTransition } from "react";

import { setWatch, type Watch } from "@/app/actions/watches";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

type Cadences = Pick<Watch, "notifyEach" | "notifyDaily" | "notifyWeekly">;

export function RemindersButton({
  activityId,
  activityName,
  initial,
}: {
  activityId: string;
  activityName: string;
  initial: Cadences;
}) {
  const [open, setOpen] = useState(false);
  const [cad, setCad] = useState<Cadences>(initial);

  const active = cad.notifyEach || cad.notifyDaily || cad.notifyWeekly;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`shrink-0 touch-manipulation rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
          active
            ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
            : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        }`}
      >
        {active ? "Reminders •" : "Reminders"}
      </button>
      {open && (
        <RemindersModal
          activityId={activityId}
          activityName={activityName}
          cad={cad}
          setCad={setCad}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RemindersModal({
  activityId,
  activityName,
  cad,
  setCad,
  onClose,
}: {
  activityId: string;
  activityName: string;
  cad: Cadences;
  setCad: (c: Cadences) => void;
  onClose: () => void;
}) {
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(key: keyof Cadences) {
    const next = { ...cad, [key]: !cad[key] };
    setCad(next); // optimistic (parent button indicator updates too)
    setError(null);
    startTransition(async () => {
      const res = await setWatch(
        activityId,
        next.notifyEach,
        next.notifyDaily,
        next.notifyWeekly
      );
      if ("error" in res) {
        setError(res.error);
        setCad(cad); // roll back
      }
    });
  }

  const rows: Array<{ key: keyof Cadences; label: string; hint: string }> = [
    {
      key: "notifyEach",
      label: "On each completion or miss",
      hint: "A nudge whenever they mark this done or missed.",
    },
    {
      key: "notifyDaily",
      label: "End of every day",
      hint: "A daily summary of how this went.",
    },
    {
      key: "notifyWeekly",
      label: "End of every week",
      hint: "A weekly “X of Y” summary.",
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reminders-modal-title"
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
              id="reminders-modal-title"
              className="break-words text-xl font-semibold tracking-tight"
            >
              Reminders
            </h2>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {activityName}
            </p>
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
          <p className="mb-4 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            These appear in your Notifications tab when you open Mission, with a
            link back to this rhythm&rsquo;s grid.
          </p>

          {error && (
            <p
              role="alert"
              className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li
                key={r.key}
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-4 py-3 dark:border-zinc-800"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="text-xs text-zinc-500">{r.hint}</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(r.key)}
                  role="switch"
                  aria-checked={cad[r.key]}
                  aria-label={r.label}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    cad[r.key]
                      ? "bg-emerald-500"
                      : "bg-zinc-300 dark:bg-zinc-700"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                      cad[r.key] ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            onClick={onClose}
            className="w-full touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
