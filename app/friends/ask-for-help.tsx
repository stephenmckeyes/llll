"use client";

// ---------------------------------------------------------------------------
// AskForHelpButton — pick one of YOUR activities you're struggling with,
// choose which friends to ask, write an optional note, and send it as a
// quoted message into each chosen friend's chat.
//
// UI notes (per user spec):
//   - Activity picker is a searchable single-select dropdown (combobox).
//     Only ever ONE activity per help request — sendHelpRequest is a
//     single-activity server action.
//   - Friend picker is a highlight-to-toggle list (no visible checkboxes).
//     Multi-select is preserved — you can ask multiple friends at once —
//     it's just expressed as row selection state rather than checkbox ticks.
//   - Friend list is capped at 60svh with a persistent scrollbar and a
//     gradient bottom fade so it's obvious there's more below the fold.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { sendHelpRequest } from "@/app/actions/messages";
import { useBodyScrollLock } from "@/lib/ui/body-scroll-lock";

type FriendOption = { id: string; name: string };
type ActivityOption = { id: string; name: string };

// A single activity may already be shared with some friends and not
// others. sendHelpRequest auto-shares to any who aren't — the modal
// warns the user via a footer note. Server sends the map as
// friendId → activityId[] (Sets can't cross the RSC boundary); the
// modal rebuilds it into a lookup Set locally.
type SharedArrayMap = Record<string, string[]>;
type SharedMap = Record<string, Set<string>>;

export function AskForHelpButton({
  friends,
  activities,
  sharedActivityIdsByFriendId = {},
}: {
  friends: FriendOption[];
  activities: ActivityOption[];
  /** friendId → activityIds already shared with them (with
   *  share_progress=true). Feeds the "will be auto-shared" note. */
  sharedActivityIdsByFriendId?: SharedArrayMap;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-fit items-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Ask for help
      </button>
      {open && (
        <AskForHelpModal
          friends={friends}
          activities={activities}
          sharedActivityIdsByFriendId={toSharedMap(
            sharedActivityIdsByFriendId
          )}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AskForHelpModal({
  friends,
  activities,
  sharedActivityIdsByFriendId,
  onClose,
}: {
  friends: FriendOption[];
  activities: ActivityOption[];
  sharedActivityIdsByFriendId: SharedMap;
  onClose: () => void;
}) {
  const [activityId, setActivityId] = useState<string>(
    activities[0]?.id ?? ""
  );
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [friendSearch, setFriendSearch] = useState("");

  useBodyScrollLock();

  const filteredFriends = useMemo(() => {
    const q = friendSearch.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => f.name.toLowerCase().includes(q));
  }, [friends, friendSearch]);

  // Count how many currently-chosen friends will get the activity
  // auto-shared with them (= they don't already have a share row for it).
  // Feeds the footer note so the user knows what will happen on submit.
  const autoShareCount = useMemo(() => {
    if (!activityId || chosen.size === 0) return 0;
    let n = 0;
    for (const fid of chosen) {
      const already = sharedActivityIdsByFriendId[fid]?.has(activityId) ?? false;
      if (!already) n++;
    }
    return n;
  }, [activityId, chosen, sharedActivityIdsByFriendId]);

  function toggleFriend(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    const activity = activities.find((a) => a.id === activityId);
    if (!activity) {
      setError("Pick an activity you'd like help with.");
      return;
    }
    if (chosen.size === 0) {
      setError("Choose at least one friend to ask.");
      return;
    }
    setError(null);
    startTransition(async () => {
      // One server call fans out to all recipients (auto-share + insert
      // messages) so we don't do N chatty round-trips.
      const res = await sendHelpRequest({
        friendIds: Array.from(chosen),
        activityId: activity.id,
        activityName: activity.name,
        note,
      });
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setSent(true);
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ask-help-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92svh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl dark:bg-zinc-950 sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-2 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 id="ask-help-title" className="text-xl font-semibold tracking-tight">
            Ask for help
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
          {sent ? (
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              Sent! Your request is in{" "}
              {chosen.size === 1 ? "their" : "each friend's"} chat.
            </p>
          ) : activities.length === 0 ? (
            <p className="text-sm text-zinc-500">
              You don&rsquo;t have any activities yet — add one first, then you
              can ask a friend for help with it.
            </p>
          ) : friends.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Add a friend first, then you can ask them for help.
            </p>
          ) : (
            <>
              {/* Activity picker: searchable single-select combobox.
                  One activity per request (server takes one activityId). */}
              <div>
                <p className="text-sm font-medium">
                  Which activity are you struggling with?
                </p>
                <ActivityCombobox
                  activities={activities}
                  value={activityId}
                  onChange={setActivityId}
                />
              </div>

              <div className="mt-4">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    Ask which friends?
                  </p>
                  <p className="text-xs text-zinc-500">
                    {chosen.size > 0
                      ? `${chosen.size} selected`
                      : "Tap a name to select"}
                  </p>
                </div>
                {friends.length > 5 && (
                  <SearchInput
                    value={friendSearch}
                    onChange={setFriendSearch}
                    placeholder="Search friends…"
                    className="mt-2"
                  />
                )}
                {/* Fixed scroll container + persistent scrollbar + soft
                    bottom fade so it's obvious the list scrolls when
                    there are more friends than fit. */}
                <div className="relative mt-2">
                  <ul
                    className="flex max-h-60 flex-col gap-1 overflow-y-scroll rounded-md border border-zinc-200 p-1 dark:border-zinc-800"
                    style={{ scrollbarGutter: "stable" }}
                  >
                    {filteredFriends.length === 0 ? (
                      <li className="px-2 py-1 text-xs italic text-zinc-500">
                        No friends match &ldquo;{friendSearch}&rdquo;.
                      </li>
                    ) : (
                      filteredFriends.map((f) => {
                        const isChosen = chosen.has(f.id);
                        return (
                          <li key={f.id}>
                            <button
                              type="button"
                              onClick={() => toggleFriend(f.id)}
                              aria-pressed={isChosen}
                              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                                isChosen
                                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                                  : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                              }`}
                            >
                              <span className="truncate">{f.name}</span>
                              {isChosen && (
                                <span
                                  aria-hidden
                                  className="shrink-0 text-xs font-semibold"
                                >
                                  ✓
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                  {/* Fade to hint at more content below when the list
                      overflows. Purely decorative — pointer-events:none
                      so it never eats a click on the last row. */}
                  {filteredFriends.length > 4 && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 rounded-b-md bg-gradient-to-t from-white to-transparent dark:from-zinc-950" />
                  )}
                </div>
              </div>

              <label className="mt-4 block">
                <span className="text-sm font-medium">
                  Note{" "}
                  <span className="font-normal text-zinc-500">(optional)</span>
                </span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  placeholder="What are you finding hard? (or just send the activity)"
                  className="mt-1 w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>

              {/* Auto-share notice — surfaces the side effect the
                  server will run so users aren't surprised by suddenly
                  sharing an activity. Only rendered when it applies
                  (autoShareCount > 0). */}
              {autoShareCount > 0 && (
                <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <strong>Heads up:</strong> {autoShareCount} of the friends
                  you selected {autoShareCount === 1 ? "doesn't" : "don't"}{" "}
                  already have this activity shared. Sending will share it
                  with them so they can check the calendar / grid / total
                  from the request.
                </p>
              )}

              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
                >
                  {error}
                </p>
              )}
            </>
          )}
        </div>

        <div className="border-t border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
          {sent ? (
            <button
              type="button"
              onClick={onClose}
              className="w-full touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={
                isPending || activities.length === 0 || friends.length === 0
              }
              className="w-full touch-manipulation rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {isPending ? "Sending…" : "Send request"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Rebuild the server-shipped array map into the modal's Set lookup.
function toSharedMap(input: SharedArrayMap): SharedMap {
  const out: SharedMap = {};
  for (const [fid, ids] of Object.entries(input)) {
    out[fid] = new Set(ids);
  }
  return out;
}

// Small controlled input used by the friend search box. Same styling
// as the search on Total View so the modal feels consistent with the
// rest of the app.
function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className ?? ""}`}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 pr-7 text-xs dark:border-zinc-700 dark:bg-zinc-900"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear"
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          ×
        </button>
      )}
    </div>
  );
}

// Searchable single-select dropdown for the activity picker. Behaves
// like a lightweight combobox — button opens a popover with a search
// input + filtered results; clicking a result selects it and closes.
// No third-party dependency; the popover positions itself absolutely
// under the trigger button.
function ActivityCombobox({
  activities,
  value,
  onChange,
}: {
  activities: ActivityOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const selected = activities.find((a) => a.id === value);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return activities;
    return activities.filter((a) => a.name.toLowerCase().includes(s));
  }, [activities, q]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Auto-focus the search box when opening.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  return (
    <div ref={rootRef} className="relative mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-left text-sm dark:border-zinc-700 dark:bg-zinc-900"
      >
        <span className={selected ? "truncate" : "truncate text-zinc-500"}>
          {selected?.name ?? "Choose an activity…"}
        </span>
        <span aria-hidden className="shrink-0 text-xs text-zinc-500">
          ▾
        </span>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-10 mt-1 flex max-h-64 flex-col overflow-hidden rounded-md border border-zinc-300 bg-white shadow-lg dark:border-zinc-700 dark:bg-zinc-950"
        >
          <div className="border-b border-zinc-200 p-2 dark:border-zinc-800">
            <input
              ref={searchRef}
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search activities…"
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <ul className="flex-1 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <li className="px-2 py-1.5 text-xs italic text-zinc-500">
                No activities match &ldquo;{q}&rdquo;.
              </li>
            ) : (
              filtered.map((a) => {
                const isSelected = a.id === value;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(a.id);
                        setOpen(false);
                        setQ("");
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${
                        isSelected
                          ? "bg-zinc-100 font-medium dark:bg-zinc-900"
                          : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
                      }`}
                    >
                      <span className="truncate">{a.name}</span>
                      {isSelected && (
                        <span aria-hidden className="shrink-0 text-xs">
                          ✓
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
