"use client";

// ---------------------------------------------------------------------------
// OnboardingForm — client form for /onboarding.
//
// Why client-side: we want to pre-fill the timezone with what the
// browser detects (Intl.DateTimeFormat().resolvedOptions().timeZone),
// which only the client knows. The server-rendered shell handles auth
// + the already-onboarded redirect.
//
// On submit the form posts to completeOnboarding, which writes the
// profile and redirects to "/". No client-side success state needed.
// ---------------------------------------------------------------------------

import { useActionState, useEffect, useRef } from "react";

import {
  completeOnboarding,
  type OnboardingState,
} from "@/app/actions/onboarding";

export function OnboardingForm({ initialEmail }: { initialEmail: string }) {
  // The timezone input is UNCONTROLLED with an empty defaultValue so
  // SSR + client hydration agree on its initial render. After mount we
  // imperatively write the browser-detected zone into the DOM via a
  // ref. Doing this without setState dodges React 19's
  // set-state-in-effect lint AND avoids a re-render — the input is
  // just a normal DOM input the user types in from there.
  const tzRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = tzRef.current;
    if (!input || input.value) return;
    try {
      input.value =
        Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    } catch {
      input.value = "UTC";
    }
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
        <span className="text-sm font-medium">Timezone</span>
        <input
          ref={tzRef}
          type="text"
          name="timezone"
          required
          defaultValue=""
          placeholder="e.g. America/New_York"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
        />
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          Used to anchor your day. We pre-filled what your browser
          reports — adjust if you actually live somewhere else.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">
          Display name{" "}
          <span className="font-normal text-zinc-500">(optional)</span>
        </span>
        <input
          type="text"
          name="displayName"
          maxLength={80}
          placeholder="What should we call you?"
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
        />
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
        className="self-end rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Saving…" : "Get started"}
      </button>
    </form>
  );
}
