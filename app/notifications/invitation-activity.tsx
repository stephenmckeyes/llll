"use client";

// ---------------------------------------------------------------------------
// InvitationActivity — invitation notices from migration 0088:
//   - "X invited you to Y"      (new invitation posted to your friends /
//                                 community) → View links to the Invitations tab
//   - "X is going to Y"          (someone added your invitation)
//   - "X is no longer going to Y" (someone removed it)
// Each is dismissible; "Dismiss all" clears the section.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { dismissInvitationActivityNotices } from "@/app/actions/invitations";
import { PendingLink } from "@/app/_components/pending-link";
import type { InvitationActivityNotice } from "@/lib/domain/invitations";

const btn =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

function fmtDate(d: string): string {
  return new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function verb(kind: InvitationActivityNotice["kind"]): string {
  if (kind === "new") return "invited you to";
  if (kind === "joined") return "is going to";
  return "is no longer going to";
}

export function InvitationActivity({ notices }: { notices: InvitationActivityNotice[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  function dismiss(id?: string) {
    setBusy(id ?? "all");
    setError(null);
    startTransition(async () => {
      const res = await dismissInvitationActivityNotices(id);
      if ("error" in res) {
        setError(res.error);
      } else {
        setDone((d) => {
          const next = new Set(d);
          for (const n of notices) if (!id || n.id === id) next.add(n.id);
          return next;
        });
        router.refresh();
      }
      setBusy(null);
    });
  }

  const visible = notices.filter((n) => !done.has(n.id));
  if (visible.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Invitations ({visible.length})
        </h2>
        {visible.length > 1 && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => dismiss()}
            className="text-xs text-zinc-500 underline-offset-2 hover:underline disabled:opacity-50"
          >
            {busy === "all" ? "Clearing…" : "Dismiss all"}
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {visible.map((n) => (
          <li
            key={n.id}
            className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="min-w-0">
              <p className="text-sm">
                <span className="font-medium">{n.actorLabel}</span> {verb(n.kind)}{" "}
                <span className="font-medium">“{n.invitationName}”</span>
              </p>
              <p className="truncate text-xs text-zinc-500">
                {n.cancelled
                  ? "Cancelled"
                  : `${fmtDate(n.startDate)} · ${n.locationName}`}
                {n.kind !== "new" &&
                  !n.cancelled &&
                  ` · ${n.attendeeCount}${n.capacity ? `/${n.capacity}` : ""} going`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {n.kind === "new" && (
                <PendingLink href="/friends/invitations" className={btn}>
                  View
                </PendingLink>
              )}
              <button
                type="button"
                disabled={isPending}
                onClick={() => dismiss(n.id)}
                className={btn}
              >
                {busy === n.id ? "…" : "Dismiss"}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
