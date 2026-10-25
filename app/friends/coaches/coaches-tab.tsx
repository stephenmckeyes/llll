"use client";

// ---------------------------------------------------------------------------
// CoachesTab — the main Coaches surface body.
//   * First-run intro.
//   * Admin review queue (verify / reject) for pending applications.
//   * Plans from your coaches (offers inbox).
//   * Your coaches / Your clients (chat, review, share, view shared).
//   * Your coaching plans (template library) for coaches.
//   * Links out to the dedicated "Find a Coach" + "Become a coach" pages.
// ---------------------------------------------------------------------------

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  endCoaching,
  getMyCoachReview,
  setCoachStatus,
  submitCoachReview,
  type CoachOffer,
  type CoachingParty,
  type MyCoachProfile,
  type PendingCoachApplication,
} from "@/app/actions/coaches";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";
import { FirstRunPopup } from "@/app/_components/agreement-prompts";
import { COACHES_INTRO, needsAck } from "@/lib/domain/agreements";
import { PendingLink } from "@/app/_components/pending-link";

import { ShareRhythmsButton } from "../share-modal";
import { CoachStatusBadge, priceLabel } from "./coach-ui";
import { CoachOffersSection } from "./coach-plans";

export function CoachesTab({
  directoryCount,
  myProfile,
  isAdmin,
  pending,
  myCoaches,
  myClients,
  offers,
  acks,
}: {
  directoryCount: number;
  myProfile: MyCoachProfile | null;
  isAdmin: boolean;
  pending: PendingCoachApplication[];
  myCoaches: CoachingParty[];
  myClients: CoachingParty[];
  offers: CoachOffer[];
  acks: Record<string, number>;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-6">
      <FirstRunPopup
        agreement={COACHES_INTRO}
        seen={!needsAck(acks, COACHES_INTRO)}
      />

      {/* Primary nav out to the dedicated pages. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <PendingLink
          href="/friends/coaches/find"
          className="flex flex-1 items-center justify-between rounded-md border border-zinc-300 px-4 py-3 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <span>Find a Coach</span>
          <span className="text-xs text-zinc-500">{directoryCount} listed →</span>
        </PendingLink>
        <PendingLink
          href="/friends/coaches/apply"
          className="flex flex-1 items-center justify-between rounded-md border border-zinc-300 px-4 py-3 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          <span>{myProfile ? "Your coach profile" : "Become a coach"}</span>
          {myProfile ? (
            <CoachStatusBadge status={myProfile.status} />
          ) : (
            <span className="text-xs text-zinc-500">→</span>
          )}
        </PendingLink>
      </div>

      {/* Admin review queue */}
      {isAdmin && <AdminReviewQueue pending={pending} />}

      {/* Your coaches — the people who coach you, plus the plans they've sent
          you (slotted here, per spec) so "plans you're using from other
          coaches" live alongside the coaches themselves. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Your coaches</h2>
        <CoachOffersSection offers={offers} />
        {myCoaches.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-4 text-center text-xs text-zinc-500 dark:border-zinc-700">
            Chats with your current and past coaches will appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {myCoaches.map((c) => (
              <PartyRow key={c.otherUserId} party={c} role="coach" />
            ))}
          </ul>
        )}
      </section>

      {/* Your clients */}
      {myClients.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Your clients</h2>
          <ul className="flex flex-col gap-2">
            {myClients.map((c) => (
              <PartyRow key={c.otherUserId} party={c} role="client" />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function PartyRow({
  party,
  role,
}: {
  party: CoachingParty;
  /** "coach" = the other person coaches me; "client" = I coach them. */
  role: "coach" | "client";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [reviewOpen, setReviewOpen] = useState(false);
  const name =
    party.displayName ?? (party.username ? `@${party.username}` : "Someone");

  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-xs text-zinc-500">
          {party.status === "ended" ? "Past" : "Active"}
          {role === "client" ? " · your client" : " · your coach"}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        <button
          type="button"
          onClick={() => router.push(`/friends/coaches/${party.otherUserId}/chat`)}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Chat
        </button>
        {role === "coach" && (
          <>
            <ShareRhythmsButton friendId={party.otherUserId} friendName={name} />
            <button
              type="button"
              onClick={() => setReviewOpen(true)}
              className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Review
            </button>
          </>
        )}
        {role === "client" && (
          <button
            type="button"
            onClick={() =>
              router.push(`/friends/coaches/${party.otherUserId}/shared`)
            }
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            View shared
          </button>
        )}
        {reviewOpen && (
          <ReviewModal
            coachUserId={party.otherUserId}
            coachName={name}
            onClose={() => setReviewOpen(false)}
            onSaved={() => {
              setReviewOpen(false);
              router.refresh();
            }}
          />
        )}
        {party.status === "active" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                const res = await endCoaching(party.otherUserId);
                if (!("error" in res)) router.refresh();
              })
            }
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            End
          </button>
        )}
      </div>
    </li>
  );
}

function ReviewModal({
  coachUserId,
  coachName,
  onClose,
  onSaved,
}: {
  coachUserId: string;
  coachName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  useBodyScrollLock();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");

  useEffect(() => {
    let active = true;
    getMyCoachReview(coachUserId).then((r) => {
      if (active && r) {
        setRating(r.rating);
        setBody(r.body ?? "");
      }
    });
    return () => {
      active = false;
    };
  }, [coachUserId]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await submitCoachReview(coachUserId, rating, body);
      if ("error" in res) setError(res.error);
      else onSaved();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-t-2xl bg-white p-5 shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <h2 className="text-lg font-semibold tracking-tight">
          Review {coachName}
        </h2>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              className={`text-2xl ${
                n <= rating ? "text-amber-500" : "text-zinc-300 dark:text-zinc-600"
              }`}
            >
              ★
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="How was your experience? (optional)"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={isPending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? "Saving…" : "Submit review"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminReviewQueue({ pending }: { pending: PendingCoachApplication[] }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        Coach applications ({pending.length})
      </h2>
      {pending.length === 0 ? (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          No applications awaiting review.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pending.map((a) => (
            <AdminReviewRow key={a.userId} app={a} />
          ))}
        </ul>
      )}
    </section>
  );
}

function AdminReviewRow({ app }: { app: PendingCoachApplication }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const name = app.displayName ?? (app.username ? `@${app.username}` : "Applicant");

  function decide(status: "verified" | "rejected") {
    setError(null);
    startTransition(async () => {
      const res = await setCoachStatus(app.userId, status);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="text-xs text-zinc-500">
          {priceLabel(app.priceAmount, app.priceUnit)}
        </p>
        {app.bio && (
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-400">
            {app.bio}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => decide("verified")}
          className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Verify
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => decide("rejected")}
          className="rounded-md border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          Reject
        </button>
      </div>
    </li>
  );
}
