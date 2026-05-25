"use client";

// ---------------------------------------------------------------------------
// OnboardingForm — two-step first-run flow:
//   1. Timezone + display name (timezone auto-detected from the browser).
//   2. A short "mission" note the user reads, then presses Start — which is
//      what actually completes onboarding (sets onboarded_at) and enters the
//      app.
//
// Both steps live in ONE <form> (the step-1 inputs stay mounted while step 2
// shows, so their values still submit). completeOnboarding redirects to "/".
// ---------------------------------------------------------------------------

import { useActionState, useEffect, useRef, useState } from "react";

import {
  completeOnboarding,
  type OnboardingState,
} from "@/app/actions/onboarding";

export function OnboardingForm({ initialEmail }: { initialEmail: string }) {
  const tzRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState<1 | 2>(1);

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

  function goToNote() {
    // Enforce the required timezone before advancing to the note screen.
    if (formRef.current && !formRef.current.reportValidity()) return;
    setStep(2);
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      {/* Step 1 — kept mounted (just hidden) on step 2 so its values still
          submit with the form. */}
      <div className={step === 1 ? "flex flex-col gap-4" : "hidden"}>
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

        <button
          type="button"
          onClick={goToNote}
          className="self-end rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Continue
        </button>
      </div>

      {/* Step 2 — the mission note + Start (which completes onboarding). */}
      <div className={step === 2 ? "flex flex-col gap-5" : "hidden"}>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-5 py-5 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-lg font-semibold tracking-tight">
            We are the Mission.
          </h2>
          <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            <p>Habit-building is identity-building.</p>
            <p>
              This app should be a helpful tool — but nothing more — for
              building, and helping others build, the habits that make up the
              identities we aspire to.
            </p>
            <p>
              Its purpose is to help people pursue more noble identities,
              deepen meaningful human connection, and grow progressively less
              reliant on the app itself — while staying useful for helping
              others progress.
            </p>
          </div>
        </div>

        {state && "error" in state && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {state.error}
          </p>
        )}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="text-sm text-zinc-500 underline-offset-2 hover:underline dark:text-zinc-400"
          >
            ← Back
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-zinc-900 px-6 py-2.5 text-base font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? "Starting…" : "Start"}
          </button>
        </div>
      </div>
    </form>
  );
}
