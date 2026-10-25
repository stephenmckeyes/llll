"use client";

// ---------------------------------------------------------------------------
// ApplyCoachView — the dedicated "Become a coach" page: the application form +
// status, gated behind the coach-conduct agreement on first submission.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  applyAsCoach,
  type CoachingParty,
  type CoachTemplate,
  type MyCoachProfile,
} from "@/app/actions/coaches";
import { TermsModal } from "@/app/_components/agreement-prompts";
import { COACH_CONDUCT_TERMS, needsAck } from "@/lib/domain/agreements";

import { PendingLink } from "@/app/_components/pending-link";
import { CoachStatusBadge } from "../coach-ui";
import { CoachTemplatesSection } from "../coach-plans";

export function ApplyCoachView({
  myProfile,
  acks,
  templates,
  clients,
}: {
  myProfile: MyCoachProfile | null;
  acks: Record<string, number>;
  templates: CoachTemplate[];
  clients: CoachingParty[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [bio, setBio] = useState(myProfile?.bio ?? "");
  const [photoUrl, setPhotoUrl] = useState(myProfile?.photoUrl ?? "");
  const [price, setPrice] = useState(
    myProfile?.priceAmount != null ? String(myProfile.priceAmount) : ""
  );
  const [unit, setUnit] = useState<"day" | "week">(myProfile?.priceUnit ?? "week");
  const [termsAccepted, setTermsAccepted] = useState(
    !!myProfile || !needsAck(acks, COACH_CONDUCT_TERMS)
  );
  const [showTerms, setShowTerms] = useState(false);

  const inputCls =
    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  function persist() {
    setError(null);
    const amount = price.trim() === "" ? null : Number(price);
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      setError("Enter a valid price, or leave it blank.");
      return;
    }
    startTransition(async () => {
      const res = await applyAsCoach({
        bio,
        photoUrl,
        priceAmount: amount,
        priceUnit: amount != null ? unit : null,
      });
      if ("error" in res) setError(res.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  function submit() {
    if (!termsAccepted) {
      setShowTerms(true);
      return;
    }
    persist();
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto bg-white p-4 dark:bg-zinc-950">
      <header className="flex flex-col gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <PendingLink
          href="/friends/coaches"
          className="inline-flex items-center text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Coaches
        </PendingLink>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            {myProfile ? "Your coach profile" : "Become a coach"}
          </h1>
          {myProfile && <CoachStatusBadge status={myProfile.status} />}
        </div>
      </header>

      {showTerms && (
        <TermsModal
          agreement={COACH_CONDUCT_TERMS}
          onCancel={() => setShowTerms(false)}
          onAccept={() => {
            setShowTerms(false);
            setTermsAccepted(true);
            persist();
          }}
        />
      )}

      {myProfile?.status === "pending" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          Your application is awaiting review.
        </p>
      )}
      {myProfile?.status === "rejected" && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          Your application wasn’t approved. You can edit and resubmit below.
        </p>
      )}

      <textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        rows={4}
        placeholder="Bio — your coaching background, specialties, approach"
        className={inputCls}
      />
      <input
        type="url"
        value={photoUrl}
        onChange={(e) => setPhotoUrl(e.target.value)}
        placeholder="Photo URL"
        className={inputCls}
      />
      <div className="flex gap-2">
        <input
          type="number"
          min={0}
          step="0.01"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Price"
          className={inputCls}
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as "day" | "week")}
          className="rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="day">per day</option>
          <option value="week">per week</option>
        </select>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          Saved — your profile is {myProfile?.status === "verified" ? "updated" : "awaiting review"}.
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={isPending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending
          ? "Submitting…"
          : myProfile
            ? "Save changes"
            : "Submit application"}
      </button>
      <p className="text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
        Submitting sends your profile for admin review. You’ll appear in the
        directory once verified.
      </p>

      {/* Your coaching plans — the coach's reusable template library lives on
          the profile (only once you've applied / have a profile). */}
      {myProfile && (
        <CoachTemplatesSection
          templates={templates}
          clients={clients}
          tagMap={{}}
          todayStr={new Date().toISOString().slice(0, 10)}
        />
      )}
    </main>
  );
}
