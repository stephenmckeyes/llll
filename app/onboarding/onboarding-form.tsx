"use client";

// ---------------------------------------------------------------------------
// OnboardingForm — single-step first-run flow: set timezone (auto-detected
// from the browser), a required username, and an optional display name, then
// press Start, which completes onboarding (sets onboarded_at) and enters the
// app.
//
// Inputs are controlled so a validation error (e.g. a taken username)
// re-renders without React 19 clearing what the user already typed.
//
// completeOnboarding redirects to "/".
// ---------------------------------------------------------------------------

import { useActionState, useEffect, useState } from "react";

import {
  completeOnboarding,
  type OnboardingState,
} from "@/app/actions/onboarding";

export function OnboardingForm({ initialEmail }: { initialEmail: string }) {
  const [timezone, setTimezone] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");

  // Auto-detect the browser timezone once, after mount. Done in an effect
  // (not a lazy initializer) to avoid an SSR/client hydration mismatch on
  // the controlled input's value — the server has no browser TZ.
  useEffect(() => {
    let tz = "UTC";
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    } catch {
      tz = "UTC";
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing a browser-only API after mount
    setTimezone((cur) => cur || tz);
  }, []);

  const [state, formAction, isPending] = useActionState<
    OnboardingState,
    FormData
  >(completeOnboarding, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        Signed in as <strong>{initialEmail}</strong>.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          Display name{" "}
          <span className="font-normal text-zinc-500">(optional)</span>
        </span>
        <input
          type="text"
          name="displayName"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={80}
          placeholder="What should we call you?"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Username</span>
        <input
          type="text"
          name="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          minLength={3}
          maxLength={30}
          pattern="[a-zA-Z0-9_.]{3,30}"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="e.g. alex_92"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
        />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          3–30 characters: letters, numbers, dot or underscore. Friends use
          this to find you and invite you to communities.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Timezone</span>
        <input
          type="text"
          name="timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          required
          placeholder="e.g. America/New_York"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
        />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Used to anchor your day. We pre-filled what your browser reports —
          adjust if you actually live somewhere else.
        </span>
      </label>

      {state && "error" in state && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="self-end rounded-md bg-zinc-900 px-6 py-2.5 text-base font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Starting…" : "Start"}
      </button>
    </form>
  );
}
