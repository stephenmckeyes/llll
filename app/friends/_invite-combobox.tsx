"use client";

// ---------------------------------------------------------------------------
// InviteCombobox — the "Invite" control in a community's Settings tab.
//
// Type to filter a dropdown of your accepted friends and click one to invite
// them; OR just type any username and hit Invite / Enter to invite someone
// who isn't your friend. Either way it resolves to a username and calls
// invite_to_community (migration 0048), which is leadership-gated server-side.
// ---------------------------------------------------------------------------

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

import {
  cancelCommunityInvite,
  getCommunityPendingInvites,
  inviteToCommunity,
  type CommunityPendingInvite,
} from "@/app/actions/communities";
import { getSocialOverview } from "@/app/actions/friends";

type Friend = { id: string; username: string; displayName: string | null };

export function InviteCombobox({ communityId }: { communityId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<CommunityPendingInvite[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  const loadPending = useCallback(() => {
    getCommunityPendingInvites(communityId)
      .then(setPending)
      .catch(() => {
        /* non-fatal */
      });
  }, [communityId]);

  // Load outstanding invites on mount and whenever the community changes.
  useEffect(() => {
    loadPending();
  }, [loadPending]);

  // Load accepted friends once (those with a username — invites resolve by
  // username, so a friend without one can't be picked from the list).
  useEffect(() => {
    let alive = true;
    getSocialOverview()
      .then((entries) => {
        if (!alive) return;
        setFriends(
          entries
            .filter((e) => e.status === "accepted" && e.otherUsername)
            .map((e) => ({
              id: e.otherId,
              username: e.otherUsername as string,
              displayName: e.otherDisplayName,
            }))
            .sort((a, b) =>
              (a.displayName ?? a.username).localeCompare(
                b.displayName ?? b.username
              )
            )
        );
      })
      .catch(() => {
        /* non-fatal: user can still type a raw username */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Close the dropdown when clicking outside the combobox.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const q = query.trim().replace(/^@/, "").toLowerCase();
  const matches = useMemo(() => {
    const base = q
      ? friends.filter(
          (f) =>
            f.username.toLowerCase().includes(q) ||
            (f.displayName ?? "").toLowerCase().includes(q)
        )
      : friends;
    return base.slice(0, 8);
  }, [friends, q]);

  function invite(usernameOrEmail: string, label?: string) {
    const u = usernameOrEmail.trim().replace(/^@/, "");
    if (!u) return;
    setError(null);
    setNotice(null);
    setOpen(false);
    // Emails contain "@" — show them as-is; bare handles get an "@" prefix.
    const shown = label ?? (u.includes("@") ? u : `@${u}`);
    startTransition(async () => {
      const res = await inviteToCommunity(communityId, u);
      if ("error" in res) {
        setError(res.error);
      } else {
        setQuery("");
        setNotice(`Invited ${shown}.`);
        loadPending();
        router.refresh();
      }
    });
  }

  function cancel(inviteId: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await cancelCommunityInvite(inviteId);
      if ("error" in res) {
        setError(res.error);
      } else {
        setPending((prev) => prev.filter((p) => p.id !== inviteId));
        router.refresh();
      }
    });
  }

  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Invite
      </h4>
      <div ref={boxRef} className="relative">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                invite(query);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Search friends, or type a username or email"
            className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={() => invite(query)}
            disabled={isPending || query.trim().length === 0}
            className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Invite
          </button>
        </div>
        {open && matches.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {matches.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() =>
                    invite(f.username, f.displayName ?? `@${f.username}`)
                  }
                  disabled={isPending}
                  className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
                >
                  <span className="text-sm font-medium">
                    {f.displayName ?? `@${f.username}`}
                  </span>
                  {f.displayName && (
                    <span className="text-xs text-zinc-500">@{f.username}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {notice && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {pending.length > 0 && (
        <div className="mt-1 flex flex-col gap-1.5">
          <p className="text-xs font-medium text-zinc-500">
            Pending invites ({pending.length})
          </p>
          <ul className="flex flex-col gap-1.5">
            {pending.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 bg-white px-3 py-1.5 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <span className="min-w-0 truncate text-sm">
                  {p.inviteeName ?? "Someone"}
                </span>
                <button
                  type="button"
                  onClick={() => cancel(p.id)}
                  disabled={isPending}
                  className="shrink-0 rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
