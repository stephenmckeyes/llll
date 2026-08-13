"use client";

// ---------------------------------------------------------------------------
// CommunityTab — the shared body of /friends/groups, /friends/clubs, and
// /friends/guilds. Same UI shape for all three kinds; per-type nuances
// (which visibilities / join policies are allowed) come from the shared
// helpers in lib/domain/community.ts, and per-type COPY is passed in.
//
// Layout (top → bottom):
//   1. Row: dropdown to pick which community · [+ New] button.
//   2. Body: the selected community's overall page (name, description,
//      members, join requests for leadership, leave button for members).
// Empty state (no communities of this kind yet): the create modal takes
// the whole body, plus a big "You have no <kind> yet — create your first
// one" prompt.
//
// Selection is driven by the `?id=<community-id>` URL param so
// deep-links + back/forward work. The server page reads the same param
// to decide what detail to fetch.
// ---------------------------------------------------------------------------

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  addCommunityActivity,
  createCommunity,
  decideJoinRequest,
  kickMember,
  leaveCommunity,
  removeCommunityActivity,
  setAutoAdd,
  setCommunityCalendarDisplay,
  setCommunityChatSettings,
  setCommunityJoinPolicy,
  setCommunityVisibility,
  setMemberRole,
  type CommunityActivityBundle,
  type CommunityCalendarDisplay,
  type CommunityChatWhoCanSpeak,
  type CommunityDetail,
  type CommunitySummary,
} from "@/app/actions/communities";
import type { SharedActivity } from "@/app/actions/sharing";
import {
  ALLOWED_JOIN_POLICIES,
  ALLOWED_VISIBILITIES,
  isLeadership,
  KIND_LABEL,
  type CommunityJoinPolicy,
  type CommunityKind,
  type CommunityRole,
  type CommunityVisibility,
} from "@/lib/domain/community";
import { summarizeRhythm } from "@/lib/domain/rhythm-summary";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

import { TagChipList } from "@/app/_components/tag-chip";

import { CopyShareModal } from "./copy-share-modal";
import { FriendCalendar } from "./[friendId]/friend-calendar";

// Per-type copy — kept here so every page passes the same props and
// deltas are one edit.
const KIND_COPY: Record<
  CommunityKind,
  { emptyHeadline: string; emptyBody: string }
> = {
  group: {
    emptyHeadline: "No groups yet",
    emptyBody:
      "Groups are private circles of friends. Create one and invite people, or ask a friend for their group's handle to request to join.",
  },
  club: {
    emptyHeadline: "No clubs yet",
    emptyBody:
      "Clubs are publicly discoverable. Create one that anyone can find, or wait for the club-discovery page to ship and browse existing ones.",
  },
  guild: {
    emptyHeadline: "No guilds yet",
    emptyBody:
      "Guilds pair shared activities with skill / adventure progression. Create one to organize learners around a specific pursuit.",
  },
};

export function CommunityTab({
  kind,
  communities,
  detail,
  bundle,
}: {
  kind: CommunityKind;
  communities: CommunitySummary[];
  detail: CommunityDetail | null;
  /** Shared-activities data for the selected community (null until one is
   *  selected / loaded). */
  bundle: CommunityActivityBundle | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [creating, setCreating] = useState(false);

  const activeId = params.get("id");

  // If the URL has ?id but that community isn't in our list (bad link,
  // just-left, etc.), the parent renders detail=null. Fall back to the
  // first one silently — the dropdown will show the correct selection.
  const effectiveId = useMemo(() => {
    if (activeId && communities.some((c) => c.id === activeId)) return activeId;
    return communities[0]?.id ?? null;
  }, [activeId, communities]);

  // Nudge the URL to match the first community when there's no ?id yet.
  // Purely cosmetic (server already used the same fallback) — keeps the
  // dropdown / URL / detail in lockstep.
  useEffect(() => {
    if (!activeId && effectiveId) {
      const qs = new URLSearchParams(params);
      qs.set("id", effectiveId);
      router.replace(`?${qs.toString()}`, { scroll: false });
    }
  }, [activeId, effectiveId, params, router]);

  function changeSelection(id: string) {
    const qs = new URLSearchParams(params);
    qs.set("id", id);
    router.push(`?${qs.toString()}`, { scroll: false });
  }

  if (communities.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight">
              {KIND_COPY[kind].emptyHeadline}
            </h2>
            <p className="truncate text-xs text-zinc-500">
              {KIND_COPY[kind].emptyBody}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex shrink-0 items-center rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            + New
          </button>
        </div>
        <div className="rounded-md border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          You&rsquo;re not in any {KIND_LABEL[kind].many} yet.
        </div>
        {creating && (
          <CreateCommunityModal
            kind={kind}
            onClose={() => setCreating(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <select
          value={effectiveId ?? ""}
          onChange={(e) => changeSelection(e.target.value)}
          aria-label={`Pick a ${KIND_LABEL[kind].one}`}
          className="flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {communities.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.myRole && c.myRole !== "member"
                ? ` · ${c.myRole === "leader" ? "leader" : "co-leader"}`
                : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex shrink-0 items-center rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          + New
        </button>
      </div>

      {detail ? (
        <>
          <CommunityOverall detail={detail} />
          {bundle && (
            <CommunityActivitiesSection detail={detail} bundle={bundle} />
          )}
          {isLeadership(detail.myRole) && (
            <CommunitySettingsSection detail={detail} />
          )}
        </>
      ) : (
        <div className="rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Loading&hellip;
        </div>
      )}

      {creating && (
        <CreateCommunityModal
          kind={kind}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overall page — top card, members list, pending requests (leadership),
// leave button.
// ---------------------------------------------------------------------------

function CommunityOverall({ detail }: { detail: CommunityDetail }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const canDecide = isLeadership(detail.myRole);

  function onDecide(requestId: string, approve: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await decideJoinRequest(requestId, approve);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  function onLeave() {
    if (
      !window.confirm(
        `Leave ${detail.name}? You can request to rejoin later if the ${KIND_LABEL[detail.kind].one} allows it.`
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await leaveCommunity(detail.id);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold tracking-tight">
              {detail.name}
            </h2>
            <p className="mt-0.5 text-xs uppercase tracking-wide text-zinc-500">
              {detail.visibility === "public" ? "Public" : "Private"} ·{" "}
              {policyLabel(detail.joinPolicy)} ·{" "}
              {detail.memberCount}{" "}
              {detail.memberCount === 1 ? "member" : "members"}
              {detail.handle && ` · @${detail.handle}`}
            </p>
          </div>
        </div>
        {detail.description && (
          <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
            {detail.description}
          </p>
        )}
      </div>

      {canDecide && detail.pendingRequests.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Pending requests ({detail.pendingRequests.length})
          </h3>
          <ul className="flex flex-col gap-2">
            {detail.pendingRequests.map((r) => (
              <li
                key={r.id}
                className="flex items-start justify-between gap-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {r.displayName ??
                      (r.username ? `@${r.username}` : "Someone")}
                  </p>
                  {r.note && (
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs text-zinc-600 dark:text-zinc-400">
                      {r.note}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => onDecide(r.id, false)}
                    disabled={isPending}
                    className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => onDecide(r.id, true)}
                    disabled={isPending}
                    className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    Approve
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Members ({detail.members.length})
        </h3>
        <ul className="flex flex-col gap-1">
          {detail.members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950"
            >
              <span className="min-w-0 truncate">
                {m.displayName ??
                  (m.username ? `@${m.username}` : "A member")}
              </span>
              <span className="shrink-0 text-xs uppercase tracking-wide text-zinc-500">
                {m.role === "leader"
                  ? "Leader"
                  : m.role === "co_leader"
                    ? "Co-leader"
                    : "Member"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {detail.myRole && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onLeave}
            disabled={isPending}
            className="rounded-md border border-red-300 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
          >
            Leave {KIND_LABEL[detail.kind].one}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared activities (Phase 3). Members see the community's shared activities
// and can copy each into their own schedule ("Add to my calendar") or opt
// into auto-adding new ones. Leadership additionally manages which activities
// are shared and how much of the calendar members see.
// ---------------------------------------------------------------------------

function CommunityActivitiesSection({
  detail,
  bundle,
}: {
  detail: CommunityDetail;
  bundle: CommunityActivityBundle;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState<SharedActivity | null>(null);
  const [autoAdd, setAutoAddState] = useState(bundle.autoAdd);
  const [addPick, setAddPick] = useState("");

  const canManage = isLeadership(detail.myRole);
  const addedIds = new Set(bundle.activities.map((a) => a.activityId));
  const addable = bundle.myActivities.filter((a) => !addedIds.has(a.id));

  function onAdd() {
    if (!addPick) return;
    setError(null);
    startTransition(async () => {
      const res = await addCommunityActivity(detail.id, addPick);
      if ("error" in res) setError(res.error);
      else {
        setAddPick("");
        router.refresh();
      }
    });
  }
  function onRemove(activityId: string) {
    setError(null);
    startTransition(async () => {
      const res = await removeCommunityActivity(detail.id, activityId);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }
  function onToggleAutoAdd() {
    const next = !autoAdd;
    setAutoAddState(next); // optimistic
    startTransition(async () => {
      const res = await setAutoAdd(detail.id, next);
      if ("error" in res) {
        setAutoAddState(!next);
        setError(res.error);
      }
    });
  }
  function onSetDisplay(mode: CommunityCalendarDisplay) {
    if (mode === detail.calendarDisplay) return;
    setError(null);
    startTransition(async () => {
      const res = await setCommunityCalendarDisplay(detail.id, mode);
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Shared activities ({bundle.activities.length})
        </h3>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={autoAdd}
            onChange={onToggleAutoAdd}
            className="h-4 w-4 accent-zinc-900 dark:accent-zinc-50"
          />
          Auto-add new ones to my calendar
        </label>
      </div>

      {canManage && (
        <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-xs text-zinc-500">
              Members&rsquo; calendar
            </span>
            <div className="flex gap-1">
              {(["light", "full"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onSetDisplay(m)}
                  aria-pressed={detail.calendarDisplay === m}
                  className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                    detail.calendarDisplay === m
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                      : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  }`}
                >
                  {m === "light" ? "Light" : "Full"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={addPick}
              onChange={(e) => setAddPick(e.target.value)}
              aria-label="Add one of your activities"
              className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="">
                {addable.length > 0
                  ? "Add one of your activities…"
                  : "No more of your activities to add"}
              </option>
              {addable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onAdd}
              disabled={!addPick || isPending}
              className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Full mode: the whole Day/Week/Month/Year calendar (reusing the
          read-only FriendCalendar). The list below stays as the copy +
          manage surface. Light mode shows just the list. */}
      {detail.calendarDisplay === "full" && bundle.activities.length > 0 && (
        <FriendCalendar
          shares={bundle.activities}
          instances={bundle.instances}
          todayStr={bundle.todayStr}
          tagMap={bundle.tagMap}
          onOpenActivity={(activityId) => {
            const act = bundle.activities.find(
              (a) => a.activityId === activityId
            );
            if (act) setCopying(act);
          }}
        />
      )}

      {bundle.activities.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-500 dark:border-zinc-700">
          No activities shared yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {bundle.activities.map((a) => (
            <li
              key={a.activityId}
              className="flex items-start justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.name}</p>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {summarizeRhythm(a.rhythm, a.scheduledTimes)}
                </p>
                {a.defaultSkillTags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <TagChipList
                      names={a.defaultSkillTags}
                      tags={bundle.tagMap}
                      size="xs"
                    />
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setCopying(a)}
                  className="touch-manipulation rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
                >
                  Add to my calendar
                </button>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => onRemove(a.activityId)}
                    disabled={isPending}
                    aria-label={`Remove ${a.name} from ${detail.name}`}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    ×
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {copying && (
        <CopyShareModal
          shared={copying}
          tagMap={bundle.tagMap}
          onClose={() => setCopying(null)}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Settings (Phase 4) — leadership-only. A collapsible area with member
// management, admittance, and chat settings. Expandable later (custom
// ranks, discovery/outsider-visibility, etc.).
// ---------------------------------------------------------------------------

function CommunitySettingsSection({ detail }: { detail: CommunityDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const policies = ALLOWED_JOIN_POLICIES[detail.kind];
  const visibilities = ALLOWED_VISIBILITIES[detail.kind];

  function run(action: Promise<{ error: string } | { ok: true }>) {
    setError(null);
    startTransition(async () => {
      const res = await action;
      if ("error" in res) setError(res.error);
      else router.refresh();
    });
  }

  const selectCls =
    "rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <details className="rounded-md border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
        Settings
      </summary>
      <div className="flex flex-col gap-6 border-t border-zinc-200 p-4 dark:border-zinc-800">
        {/* Members */}
        <section className="flex flex-col gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Members ({detail.members.length})
          </h4>
          <ul className="flex flex-col gap-1">
            {detail.members.map((m) => {
              const isSelf = m.userId === detail.myUserId;
              return (
                <li
                  key={m.userId}
                  className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                >
                  <span className="min-w-0 truncate">
                    {m.displayName ??
                      (m.username ? `@${m.username}` : "A member")}
                    {isSelf && (
                      <span className="ml-1 text-xs text-zinc-400">(you)</span>
                    )}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
                    <select
                      value={m.role}
                      disabled={isPending || isSelf}
                      aria-label={`Role for ${m.displayName ?? "member"}`}
                      onChange={(e) =>
                        run(
                          setMemberRole(
                            detail.id,
                            m.userId,
                            e.target.value as CommunityRole
                          )
                        )
                      }
                      className={selectCls}
                    >
                      <option value="leader">Leader</option>
                      <option value="co_leader">Co-leader</option>
                      <option value="member">Member</option>
                    </select>
                    {!isSelf && m.role !== "leader" && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => run(kickMember(detail.id, m.userId))}
                        className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                      >
                        Kick
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Admittance */}
        <section className="flex flex-col gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Admittance
          </h4>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span>Join policy</span>
            <select
              value={detail.joinPolicy}
              disabled={isPending}
              onChange={(e) =>
                run(
                  setCommunityJoinPolicy(
                    detail.id,
                    e.target.value as CommunityJoinPolicy
                  )
                )
              }
              className={selectCls}
            >
              {policies.map((p) => (
                <option key={p} value={p}>
                  {p === "open"
                    ? "Open"
                    : p === "application"
                      ? "Application"
                      : "Invite-only"}
                </option>
              ))}
            </select>
          </label>
          {visibilities.length > 1 && (
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>Visibility</span>
              <select
                value={detail.visibility}
                disabled={isPending}
                onChange={(e) =>
                  run(
                    setCommunityVisibility(
                      detail.id,
                      e.target.value as CommunityVisibility
                    )
                  )
                }
                className={selectCls}
              >
                {visibilities.map((v) => (
                  <option key={v} value={v}>
                    {v === "public" ? "Public" : "Private"}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        {/* Chat */}
        <section className="flex flex-col gap-2">
          <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Chat
          </h4>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={detail.chatEnabled}
              disabled={isPending}
              onChange={(e) =>
                run(
                  setCommunityChatSettings(
                    detail.id,
                    e.target.checked,
                    detail.chatWhoCanSpeak
                  )
                )
              }
              className="h-4 w-4 accent-zinc-900 dark:accent-zinc-50"
            />
            Enable community chat
          </label>
          <label className="flex items-center justify-between gap-2 text-sm">
            <span>Who can speak</span>
            <select
              value={detail.chatWhoCanSpeak}
              disabled={isPending || !detail.chatEnabled}
              onChange={(e) =>
                run(
                  setCommunityChatSettings(
                    detail.id,
                    detail.chatEnabled,
                    e.target.value as CommunityChatWhoCanSpeak
                  )
                )
              }
              className={selectCls}
            >
              <option value="everyone">Everyone</option>
              <option value="leadership">Leadership only</option>
            </select>
          </label>
          <p className="text-xs text-zinc-500">
            The chat itself ships in a later phase — these settings are ready
            for it.
          </p>
        </section>

        {error && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}
      </div>
    </details>
  );
}

function policyLabel(p: CommunityJoinPolicy): string {
  return p === "open"
    ? "Open"
    : p === "application"
      ? "Application"
      : "Invite-only";
}

// ---------------------------------------------------------------------------
// Create modal
// ---------------------------------------------------------------------------

function CreateCommunityModal({
  kind,
  onClose,
}: {
  kind: CommunityKind;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [handle, setHandle] = useState("");
  const [visibility, setVisibility] = useState<CommunityVisibility>(
    ALLOWED_VISIBILITIES[kind][0]
  );
  const [joinPolicy, setJoinPolicy] = useState<CommunityJoinPolicy>(
    ALLOWED_JOIN_POLICIES[kind][0]
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useBodyScrollLock();

  const visibilities = ALLOWED_VISIBILITIES[kind];
  const policies = ALLOWED_JOIN_POLICIES[kind];

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createCommunity({
        kind,
        name,
        description,
        handle,
        visibility,
        joinPolicy,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      // Land the user on the new community and refresh so the server
      // page picks it up.
      const qs = new URLSearchParams();
      qs.set("id", res.id);
      router.push(`?${qs.toString()}`, { scroll: false });
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-community-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 id="new-community-title" className="text-xl font-semibold tracking-tight">
            New {KIND_LABEL[kind].one}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            <span className="text-xl leading-none">×</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <label className="block">
            <span className="text-sm font-medium">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder={`My ${KIND_LABEL[kind].one}`}
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="mt-4 block">
            <span className="text-sm font-medium">
              Description{" "}
              <span className="font-normal text-zinc-500">(optional)</span>
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="What's this for?"
              className="mt-1 w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="mt-4 block">
            <span className="text-sm font-medium">
              Handle{" "}
              <span className="font-normal text-zinc-500">(optional)</span>
            </span>
            <p className="text-xs text-zinc-500">
              3–32 chars, lowercase letters / digits / _ / -. Used so friends
              can search for your {KIND_LABEL[kind].one}.
            </p>
            <div className="mt-1 flex items-center rounded-md border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
              <span className="pl-3 text-sm text-zinc-500">@</span>
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                maxLength={32}
                placeholder="my-handle"
                className="flex-1 rounded-md bg-transparent px-2 py-2 text-sm outline-none"
              />
            </div>
          </label>

          {visibilities.length > 1 && (
            <fieldset className="mt-4">
              <legend className="text-sm font-medium">Visibility</legend>
              <div className="mt-1 flex flex-col gap-1">
                {visibilities.map((v) => (
                  <label
                    key={v}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <input
                      type="radio"
                      name="visibility"
                      value={v}
                      checked={visibility === v}
                      onChange={() => setVisibility(v)}
                      className="h-4 w-4"
                    />
                    <span>{v === "public" ? "Public" : "Private"}</span>
                    <span className="text-xs text-zinc-500">
                      {v === "public"
                        ? "Discoverable by anyone."
                        : "Handle- or invite-only."}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Join policy</legend>
            <div className="mt-1 flex flex-col gap-1">
              {policies.map((p) => (
                <label
                  key={p}
                  className="flex cursor-pointer items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="joinPolicy"
                    value={p}
                    checked={joinPolicy === p}
                    onChange={() => setJoinPolicy(p)}
                    className="h-4 w-4"
                  />
                  <span>
                    {p === "open"
                      ? "Open — anyone can join"
                      : p === "application"
                        ? "Application — request + approve"
                        : "Invite-only"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
            >
              {error}
            </p>
          )}
        </div>

        <div className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          <button
            type="button"
            onClick={submit}
            disabled={isPending || name.trim().length === 0}
            className="w-full touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {isPending ? "Creating…" : `Create ${KIND_LABEL[kind].one}`}
          </button>
        </div>
      </div>
    </div>
  );
}
