"use client";

// ---------------------------------------------------------------------------
// CommunityChat — a community's group chat. Reads via getCommunityMessages
// (RLS: members only), posts via postCommunityMessage (gated by the
// community's chat settings). System notices (community changes) render as
// centered muted lines and can be filtered out with the "Hide updates"
// toggle. Light 15s poll + refresh-on-focus, like the 1:1 friend chat.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState, useTransition } from "react";

import {
  getCommunityMessages,
  postCommunityMessage,
  type CommunityMessage,
} from "@/app/actions/communities";

export function CommunityChat({
  communityId,
  currentUserId,
  canPost,
}: {
  communityId: string;
  currentUserId: string;
  /** Whether the viewer may post (chat enabled + who-can-speak allows). */
  canPost: boolean;
}) {
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [hideSystem, setHideSystem] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load + poll.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const msgs = await getCommunityMessages(communityId);
      if (!cancelled) setMessages(msgs);
    };
    load();
    const id = setInterval(load, 15000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [communityId]);

  const visible = hideSystem
    ? messages.filter((m) => m.kind !== "system")
    : messages;

  // Keep pinned to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  function send() {
    const text = body.trim();
    if (!text) return;
    setBody("");
    setError(null);
    startTransition(async () => {
      const res = await postCommunityMessage(communityId, text);
      if ("error" in res) {
        setError(res.error);
        setBody(text); // restore so the user doesn't lose it
        return;
      }
      setMessages(await getCommunityMessages(communityId));
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Chat
        </h3>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={hideSystem}
            onChange={(e) => setHideSystem(e.target.checked)}
            className="h-4 w-4 accent-zinc-900 dark:accent-zinc-50"
          />
          Hide updates
        </label>
      </div>

      <div
        ref={scrollRef}
        className="flex max-h-80 min-h-[8rem] flex-col gap-2 overflow-y-auto rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
      >
        {visible.length === 0 ? (
          <p className="my-6 text-center text-sm text-zinc-500">
            No messages yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((m) =>
              m.kind === "system" ? (
                <li
                  key={m.id}
                  className="my-1 text-center text-xs italic text-zinc-500 dark:text-zinc-400"
                >
                  {m.body}
                </li>
              ) : (
                <MessageBubble
                  key={m.id}
                  mine={m.senderId === currentUserId}
                  sender={
                    m.senderDisplayName ??
                    (m.senderUsername ? `@${m.senderUsername}` : "Someone")
                  }
                  body={m.body}
                />
              )
            )}
          </ul>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {canPost ? (
        <div className="flex items-end gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder="Message the community…"
            className="max-h-32 min-h-[2.5rem] flex-1 resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
          />
          <button
            type="button"
            onClick={send}
            disabled={!body.trim()}
            className="shrink-0 touch-manipulation rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Send
          </button>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          Only leadership can post in this chat.
        </p>
      )}
    </div>
  );
}

function MessageBubble({
  mine,
  sender,
  body,
}: {
  mine: boolean;
  sender: string;
  body: string;
}) {
  return (
    <li className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      {!mine && (
        <span className="px-1 text-[10px] text-zinc-500">{sender}</span>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
          mine
            ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{body}</p>
      </div>
    </li>
  );
}
