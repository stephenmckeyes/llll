"use client";

// ---------------------------------------------------------------------------
// CoachesTab — the Coaches surface body (phase 1, migration 0072).
//
//   * "Find a Coach" directory of verified coaches.
//   * "Become a coach" / "Your coach profile" application form + status.
//   * Admin review queue (verify / reject) for pending applications.
//
// Coach↔client chat, activity sharing, and the coach activity cache are later
// phases (noted inline).
// ---------------------------------------------------------------------------

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  applyAsCoach,
  endCoaching,
  getCoachReviews,
  getMyCoachReview,
  setCoachStatus,
  startCoaching,
  submitCoachReview,
  type CoachDirectoryEntry,
  type CoachOffer,
  type CoachReview,
  type CoachTemplate,
  type CoachingParty,
  type MyCoachProfile,
  type PendingCoachApplication,
} from "@/app/actions/coaches";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

import { CoachOffersSection, CoachTemplatesSection } from "./coach-plans";

function priceLabel(amount: number | null, unit: "day" | "week" | null): string {
  if (amount == null || unit == null) return "Price on request";
  const n = Number(amount);
  const money = Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
  return `${money} / ${unit}`;
}

function initials(name: string | null, username: string | null): string {
  const base = (name ?? username ?? "?").trim();
  const parts = base.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

export function CoachesTab({
  directory,
  myProfile,
  isAdmin,
  pending,
  myCoaches,
  myClients,
  offers,
  templates,
}: {
  directory: CoachDirectoryEntry[];
  myProfile: MyCoachProfile | null;
  isAdmin: boolean;
  pending: PendingCoachApplication[];
  myCoaches: CoachingParty[];
  myClients: CoachingParty[];
  offers: CoachOffer[];
  templates: CoachTemplate[];
}) {
  const [applyOpen, setApplyOpen] = useState(false);
  const myCoachIds = new Set(
    myCoaches.filter((c) => c.status === "active").map((c) => c.otherUserId)
  );
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pb-6">
      {/* Admin review queue */}
      {isAdmin && (
        <AdminReviewQueue pending={pending} />
      )}

      {/* Plans offered to me by my coaches (client side) */}
      <CoachOffersSection offers={offers} />

      {/* Your coaches — current + past relationships with a chat link each. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold tracking-tight">Your coaches</h2>
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

      {/* Your clients — shown to coaches who have engaged clients. */}
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

      {/* Coach plan library — only for coaches (people who've applied). */}
      {myProfile && (
        <CoachTemplatesSection
          templates={templates}
          clients={myClients}
          tagMap={{}}
          todayStr={todayStr}
        />
      )}

      {/* Find a Coach */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Find a Coach</h2>
        {directory.length === 0 ? (
          <p className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
            No coaches listed yet. Verified coaches will show up here.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {directory.map((c) => (
              <CoachCard
                key={c.userId}
                coach={c}
                engaged={myCoachIds.has(c.userId)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Become a coach */}
      <section className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">
            {myProfile ? "Your coach profile" : "Become a coach"}
          </h2>
          {myProfile && <CoachStatusBadge status={myProfile.status} />}
        </div>
        {!applyOpen ? (
          <button
            type="button"
            onClick={() => setApplyOpen(true)}
            className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {myProfile ? "Edit application" : "Apply to be a coach"}
          </button>
        ) : (
          <ApplyForm
            initial={myProfile}
            onDone={() => setApplyOpen(false)}
          />
        )}
        {myProfile?.status === "pending" && !applyOpen && (
          <p className="text-xs text-zinc-500">
            Your application is awaiting review.
          </p>
        )}
        {myProfile?.status === "rejected" && !applyOpen && (
          <p className="text-xs text-zinc-500">
            Your application wasn’t approved. You can edit and resubmit.
          </p>
        )}
      </section>
    </div>
  );
}

function CoachStatusBadge({
  status,
}: {
  status: "pending" | "verified" | "rejected";
}) {
  const cls =
    status === "verified"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      : status === "rejected"
        ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
        : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300";
  const label =
    status === "verified"
      ? "Verified"
      : status === "rejected"
        ? "Not approved"
        : "Pending review";
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
  );
}

function CoachCard({
  coach,
  engaged,
}: {
  coach: CoachDirectoryEntry;
  engaged: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const name = coach.displayName ?? (coach.username ? `@${coach.username}` : "Coach");

  function message() {
    startTransition(async () => {
      // Engaging is idempotent (reactivates if ended); then open the chat.
      const res = await startCoaching(coach.userId);
      if (!("error" in res)) {
        router.push(`/friends/coaches/${coach.userId}/chat`);
      }
    });
  }

  return (
    <li className="flex items-start gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      {coach.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={coach.photoUrl}
          alt=""
          className="h-14 w-14 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {initials(coach.displayName, coach.username)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm font-semibold">{name}</p>
          <span className="shrink-0 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            {priceLabel(coach.priceAmount, coach.priceUnit)}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
          {coach.ratingCount > 0
            ? `★ ${coach.ratingAvg} (${coach.ratingCount})`
            : "No reviews yet"}
        </p>
        {coach.bio && (
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-400">
            {coach.bio}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={message}
            disabled={isPending}
            className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {engaged ? "Message" : "Message coach"}
          </button>
          {coach.ratingCount > 0 && <ReviewsExpander coach={coach} />}
        </div>
      </div>
    </li>
  );
}

function ReviewsExpander({ coach }: { coach: CoachDirectoryEntry }) {
  const [open, setOpen] = useState(false);
  const [reviews, setReviews] = useState<CoachReview[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (reviews === null) {
      startTransition(async () => {
        setReviews(await getCoachReviews(coach.userId));
      });
    }
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={toggle}
        className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {open ? "Hide reviews" : `See reviews (${coach.ratingCount})`}
      </button>
      {open && (
        <ul className="mt-2 flex w-full flex-col gap-1.5">
          {isPending && reviews === null ? (
            <li className="text-xs text-zinc-500">Loading…</li>
          ) : (
            (reviews ?? []).map((r, i) => (
              <li
                key={i}
                className="rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-900"
              >
                <p className="font-medium text-amber-600 dark:text-amber-400">
                  {"★".repeat(r.rating)}
                  {"☆".repeat(5 - r.rating)}{" "}
                  <span className="font-normal text-zinc-500">
                    {r.reviewerName}
                  </span>
                </p>
                {r.body && (
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-zinc-600 dark:text-zinc-400">
                    {r.body}
                  </p>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
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

  // Prefill an existing review.
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
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={() => router.push(`/friends/coaches/${party.otherUserId}/chat`)}
          className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Chat
        </button>
        {role === "coach" && (
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Review
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

function ApplyForm({
  initial,
  onDone,
}: {
  initial: MyCoachProfile | null;
  onDone: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [photoUrl, setPhotoUrl] = useState(initial?.photoUrl ?? "");
  const [price, setPrice] = useState(
    initial?.priceAmount != null ? String(initial.priceAmount) : ""
  );
  const [unit, setUnit] = useState<"day" | "week">(initial?.priceUnit ?? "week");

  const inputCls =
    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900";

  function submit() {
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
        onDone();
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <textarea
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        rows={3}
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
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? "Submitting…" : "Submit application"}
        </button>
      </div>
      <p className="text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">
        Submitting sends your profile for admin review. You’ll appear in the
        directory once verified.
      </p>
    </div>
  );
}

function AdminReviewQueue({
  pending,
}: {
  pending: PendingCoachApplication[];
}) {
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
      <div className="flex items-start justify-between gap-2">
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
