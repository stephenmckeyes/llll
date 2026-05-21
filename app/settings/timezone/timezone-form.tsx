"use client";

// ---------------------------------------------------------------------------
// TimezoneForm — controlled input pre-filled with the user's stored TZ,
// plus a "Use browser-detected" button so they can re-sync to whatever
// their current device reports.
// ---------------------------------------------------------------------------

import { useActionState, useState } from "react";

import {
  updateProfile,
  type UpdateProfileState,
} from "@/app/actions/profile";

const inputClasses =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50";

export function TimezoneForm({
  initialTimezone,
}: {
  initialTimezone: string;
}) {
  const [tz, setTz] = useState(initialTimezone);
  const [state, formAction, isPending] = useActionState<
    UpdateProfileState,
    FormData
  >(updateProfile, null);

  function detectBrowser() {
    try {
      const detected =
        Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
      setTz(detected);
    } catch {
      setTz("UTC");
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="block">
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
          Timezone
        </span>
        <input
          type="text"
          name="timezone"
          required
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          placeholder="e.g. America/New_York"
          className={`${inputClasses} mt-1`}
        />
      </label>

      <button
        type="button"
        onClick={detectBrowser}
        className="self-start text-xs text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
      >
        Use browser-detected
      </button>

      {state && "error" in state && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}
      {state && "ok" in state && (
        <p
          role="status"
          className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        >
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
