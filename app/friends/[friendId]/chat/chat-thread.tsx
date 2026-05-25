"use client";

// ---------------------------------------------------------------------------
// ChatThread — the message list + composer for a 1:1 friend chat.
//
// Messages come from the server (getConversation). Sending appends an
// optimistic bubble and refreshes; a light 15s poll (+ refresh on focus)
// pulls in the friend's new messages without a websocket. Quoted activities
// render as a small block above the message body.
// ---------------------------------------------------------------------------

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { sendMessage, type Message } from "@/app/actions/messages";

export function ChatThread({
  friendId,
  friendName,
  currentUserId,
  messages,
}: {
  friendId: string;
  friendName: string;
  currentUserId: string;
  messages: Message[];
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<
    Array<{ tempId: string; body: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Clear optimistic bubbles once the server thread reflects them. The
  // message-id list is the snapshot key (React-19-friendly, no effect).
  const idsKey = messages.map((m) => m.id).join(",");
  const [lastIdsKey, setLastIdsKey] = useState(idsKey);
  if (lastIdsKey !== idsKey) {
    setLastIdsKey(idsKey);
    if (pending.length > 0) setPending([]);
  }

  // Light polling for incoming messages + refresh when the tab regains focus.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), 15000);
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [router]);

  // Keep the view pinned to the newest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [idsKey, pending.length]);

  function send() {
    const text = body.trim();
    if (!text) return;
    const tempId = `temp-${Date.now()}`;
    setPending((p) => [...p, { tempId, body: text }]);
    setBody("");
    setError(null);
    startTransition(async () => {
      const res = await sendMessage(friendId, text);
      if ("error" in res) {
        setError(res.error);
        setPending((p) => p.filter((m) => m.tempId !== tempId));
      } else {
        router.refresh();
      }
    });
  }

  const empty = messages.length === 0 && pending.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-4"
      >
        {empty ? (
          <p className="mt-8 text-center text-sm text-zinc-500">
            No messages yet. Say hi to {friendName}.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                mine={m.senderId === currentUserId}
                body={m.body}
                quotedName={m.quotedActivityName}
              />
            ))}
            {pending.map((m) => (
              <MessageBubble key={m.tempId} mine body={m.body} sending />
            ))}
          </ul>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="flex items-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter newlines.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder={`Message ${friendName}…`}
          className="max-h-32 min-h-[2.75rem] flex-1 resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50"
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
    </div>
  );
}

function MessageBubble({
  mine,
  body,
  quotedName,
  sending = false,
}: {
  mine: boolean;
  body: string;
  quotedName?: string | null;
  sending?: boolean;
}) {
  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
          mine
            ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
        } ${sending ? "opacity-60" : ""}`}
      >
        {quotedName && (
          <div
            className={`mb-1 rounded-md border-l-2 px-2 py-1 text-xs ${
              mine
                ? "border-white/40 bg-white/10"
                : "border-zinc-400 bg-black/5 dark:border-zinc-500 dark:bg-white/5"
            }`}
          >
            <span className="opacity-70">Re: </span>
            <span className="font-medium">{quotedName}</span>
          </div>
        )}
        {body && <p className="whitespace-pre-wrap break-words">{body}</p>}
      </div>
    </li>
  );
}
