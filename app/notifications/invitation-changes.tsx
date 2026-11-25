"use client";

// ---------------------------------------------------------------------------
// InvitationChanges — "an invitation you joined changed" notices (migration
// 0086). Each shows what the host changed (from → to) with options to:
//   - Apply changes   → sync just the changed fields onto your calendar copy
//   - Edit my copy    → open your copy on the calendar to adjust it yourself
//   - Keep mine       → leave your copy as it is
// A cancelled invitation offers "Remove from my calendar" / "Keep it".
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  applyInvitationChange,
  keepInvitationCopy,
  removeCancelledInvitation,
} from "@/app/actions/invitations";
import { PendingLink } from "@/app/_components/pending-link";
import {
  CHANGE_FIELD_LABEL,
  CHANGE_FIELD_ORDER,
  type InvitationChangeNotice,
  type InvitationChanges,
  type InvitationTimesValue,
} from "@/lib/domain/invitations";
import { summarizeRhythm } from "@/lib/domain/rhythm-summary";
import { formatTimeRange, type TimeFormat } from "@/lib/ui/format-time";
import { useTimeFormat } from "@/lib/ui/format-time-client";
import type { Rhythm } from "@/lib/validators/rhythm";

const btn =
  "rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800";
const primary =
  "rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300";

function fmtDate(d: string | null): string {
  if (!d) return "none";
  return new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtTimes(v: InvitationTimesValue | null | undefined, tf: TimeFormat): string {
  const starts = v?.starts ?? [];
  if (starts.length === 0) return "no time";
  return starts.map((s, i) => formatTimeRange(s, v?.ends?.[i], tf)).join(", ");
}

function fmtValue(
  key: keyof InvitationChanges,
  value: unknown,
  tf: TimeFormat
): string {
  switch (key) {
    case "start_date":
    case "end_date":
      return fmtDate(value as string | null);
    case "rhythm":
      return value ? summarizeRhythm(value as Rhythm, []) : "—";
    case "times":
      return fmtTimes(value as InvitationTimesValue, tf);
    case "tags": {
      const t = (value as string[] | null) ?? [];
      return t.length ? t.join(", ") : "no tags";
    }
    case "notes":
      return (value as string | null)?.trim() || "no notes";
    default:
      return String(value ?? "—");
  }
}

/** Fields to list. A one-day event whose end date just moved with its start
 *  shows only "Date" (the end-date line would repeat it). */
function visibleFields(changes: InvitationChanges): Array<keyof InvitationChanges> {
  const s = changes.start_date;
  const e = changes.end_date;
  const endMirrorsStart =
    s !== undefined &&
    e !== undefined &&
    e.from?.slice(0, 10) === s.from?.slice(0, 10) &&
    e.to?.slice(0, 10) === s.to?.slice(0, 10);
  return CHANGE_FIELD_ORDER.filter(
    (k) => changes[k] !== undefined && !(k === "end_date" && endMirrorsStart)
  );
}

export function InvitationChanges({ notices }: { notices: InvitationChangeNotice[] }) {
  const router = useRouter();
  const tf = useTimeFormat();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Set<string>>(new Set());

  function run(id: string, fn: () => Promise<{ error: string } | { ok: true }>) {
    setBusyId(id);
    startTransition(async () => {
      const res = await fn();
      if ("error" in res) {
        setErrors((e) => ({ ...e, [id]: res.error }));
      } else {
        setDone((d) => new Set(d).add(id));
        router.refresh();
      }
      setBusyId(null);
    });
  }

  const visible = notices.filter((n) => !done.has(n.id));
  if (visible.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Invitation updates ({visible.length})
      </h2>
      <ul className="flex flex-col gap-2">
        {visible.map((n) => {
          const busy = isPending && busyId === n.id;
          const fields = visibleFields(n.changes);
          const editHref = n.nextDate ? `/?view=day&date=${n.nextDate}` : null;
          return (
            <li
              key={n.id}
              className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <p className="text-sm">
                <span className="font-medium">{n.hostLabel}</span>{" "}
                {n.kind === "cancelled" ? "cancelled" : "changed"}{" "}
                <span className="font-medium">“{n.invitationName}”</span>
              </p>

              {n.kind === "updated" && fields.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-xs">
                  {fields.map((k) => {
                    const c = n.changes[k] as { from: unknown; to: unknown };
                    return (
                      <li key={k} className="text-zinc-600 dark:text-zinc-400">
                        <span className="font-medium text-zinc-800 dark:text-zinc-200">
                          {CHANGE_FIELD_LABEL[k]}:
                        </span>{" "}
                        <span className="line-through decoration-zinc-400">
                          {fmtValue(k, c.from, tf)}
                        </span>{" "}
                        → <span className="text-zinc-900 dark:text-zinc-100">{fmtValue(k, c.to, tf)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}

              {n.kind === "cancelled" && (
                <p className="text-xs text-zinc-500">
                  {n.activityId
                    ? "It's still on your calendar."
                    : "It's not on your calendar anymore."}
                </p>
              )}
              {n.kind === "updated" && !n.activityId && (
                <p className="text-xs text-zinc-500">
                  Your copy isn&rsquo;t on your calendar anymore.
                </p>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                {n.kind === "updated" && n.activityId && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(n.id, () => applyInvitationChange(n.id))}
                      className={primary}
                    >
                      {busy ? "Updating…" : "Apply changes"}
                    </button>
                    {editHref && (
                      <PendingLink href={editHref} className={btn}>
                        Edit my copy
                      </PendingLink>
                    )}
                  </>
                )}
                {n.kind === "cancelled" && n.activityId && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(n.id, () => removeCancelledInvitation(n.id))}
                    className={primary}
                  >
                    {busy ? "Removing…" : "Remove from my calendar"}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(n.id, () => keepInvitationCopy(n.id))}
                  className={btn}
                >
                  {!n.activityId ? "Dismiss" : n.kind === "cancelled" ? "Keep it" : "Keep mine"}
                </button>
              </div>

              {errors[n.id] && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                  {errors[n.id]}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
