"use client";

// ---------------------------------------------------------------------------
// AccountForms — three independent forms on /settings/account.
//
//   1. Display name + (nothing else for now)  → updateProfile
//   2. Change email                            → updateAuthEmail
//   3. Change password                         → updateAuthPassword
//
// Each form has its own useActionState so error / success states don't
// bleed across sections. Submit buttons are scoped to each form so a
// user editing one field doesn't accidentally fire another.
// ---------------------------------------------------------------------------

import { useActionState } from "react";

import {
  updateAuthEmail,
  updateAuthPassword,
  updateProfile,
  type UpdateAuthEmailState,
  type UpdateAuthPasswordState,
  type UpdateProfileState,
} from "@/app/actions/profile";

const inputClasses =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50";

export function AccountForms({
  currentEmail,
  currentDisplayName,
  currentUsername,
}: {
  currentEmail: string;
  currentDisplayName: string;
  currentUsername: string;
}) {
  // NOTE (dev): 2FA enrollment via Supabase MFA is tracked in BACKLOG —
  // intentionally NOT surfaced to users as a "coming soon" note.
  return (
    <div className="flex flex-col gap-8">
      <ProfileForm
        initialName={currentDisplayName}
        initialUsername={currentUsername}
      />
      <EmailForm currentEmail={currentEmail} />
      <PasswordForm />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProfileForm({
  initialName,
  initialUsername,
}: {
  initialName: string;
  initialUsername: string;
}) {
  const [state, formAction, isPending] = useActionState<
    UpdateProfileState,
    FormData
  >(updateProfile, null);

  return (
    <FormSection title="Profile">
      <form action={formAction} className="flex flex-col gap-3">
        <label className="block">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Display name
          </span>
          <input
            type="text"
            name="displayName"
            maxLength={80}
            defaultValue={initialName}
            placeholder="(optional)"
            className={`${inputClasses} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Username
          </span>
          <input
            type="text"
            name="username"
            defaultValue={initialUsername}
            placeholder="e.g. stephen_m"
            className={`${inputClasses} mt-1`}
          />
          <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">
            Friends can find you by this. 3–30 characters: letters,
            numbers, dot or underscore. (They can also find you by your
            email.)
          </span>
        </label>
        <StateMessage state={state} />
        <SubmitButton isPending={isPending} label="Save" />
      </form>
    </FormSection>
  );
}

function EmailForm({ currentEmail }: { currentEmail: string }) {
  const [state, formAction, isPending] = useActionState<
    UpdateAuthEmailState,
    FormData
  >(updateAuthEmail, null);

  return (
    <FormSection title="Email">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Currently signed in as <strong>{currentEmail}</strong>. Changing
        your email sends a confirmation link to the new address — the
        switch only happens after you click it.
      </p>
      <form action={formAction} className="flex flex-col gap-2">
        <label className="block">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            New email
          </span>
          <input
            type="email"
            name="email"
            required
            placeholder="you@example.com"
            className={`${inputClasses} mt-1`}
          />
        </label>
        <StateMessage state={state} />
        <SubmitButton isPending={isPending} label="Send confirmation" />
      </form>
    </FormSection>
  );
}

function PasswordForm() {
  const [state, formAction, isPending] = useActionState<
    UpdateAuthPasswordState,
    FormData
  >(updateAuthPassword, null);

  return (
    <FormSection title="Password">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Minimum 6 characters. Change applies immediately.
      </p>
      <form action={formAction} className="flex flex-col gap-2">
        <label className="block">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            New password
          </span>
          <input
            type="password"
            name="password"
            required
            minLength={6}
            autoComplete="new-password"
            className={`${inputClasses} mt-1`}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Confirm
          </span>
          <input
            type="password"
            name="confirm"
            required
            minLength={6}
            autoComplete="new-password"
            className={`${inputClasses} mt-1`}
          />
        </label>
        <StateMessage state={state} />
        <SubmitButton isPending={isPending} label="Change password" />
      </form>
    </FormSection>
  );
}

// ---------------------------------------------------------------------------

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function StateMessage({
  state,
}: {
  state:
    | UpdateProfileState
    | UpdateAuthEmailState
    | UpdateAuthPasswordState
    | null;
}) {
  if (!state) return null;
  if ("error" in state) {
    return (
      <p
        role="alert"
        className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300"
      >
        {state.error}
      </p>
    );
  }
  return (
    <p
      role="status"
      className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
    >
      {state.message}
    </p>
  );
}

function SubmitButton({
  isPending,
  label,
}: {
  isPending: boolean;
  label: string;
}) {
  return (
    <button
      type="submit"
      disabled={isPending}
      className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
    >
      {isPending ? "Saving…" : label}
    </button>
  );
}
