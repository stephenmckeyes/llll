"use client";

// ---------------------------------------------------------------------------
// ChatThread — the message list + composer for a 1:1 friend chat.
//
// Messages come from the server (getConversation). Sending appends an
// optimistic bubble and refreshes; a light 15s poll (+ refresh on focus)
// pulls in the friend's new messages without a websocket. Quoted activities
// render as a small block above the message body — and when the quoted
// activity is one the friend has shared with you, the block is tappable and
// opens that activity's full read-only detail (so you know which one it is).
// ---------------------------------------------------------------------------

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { sendMessage, type Message } from "@/app/actions/messages";
import type { SharedActivity } from "@/app/actions/sharing";
import type { TagMap } from "@/lib/domain/tags";

import { CopyShareModal } from "../../copy-share-modal";
import type { Occurrence } from "../shared-data";
import { SharedActivityModal } from "../shared-activity-modal";

export type WatchMap = Record<
  string,
  { notifyEach: boolean; notifyDaily: boolean; notifyWeekly: boolean }
>;

const NO_WATCH = { notifyEach: false, notifyDaily: false, notifyWeekly: false };

export function ChatThread({
  friendId,
  friendName,
  currentUserId,
  messages,
  sharedById,
  watchMap,
  tagMap,
}: {
  friendId: string;
  friendName: string;
  currentUserId: string;
  messages: Message[];
  /** Activities the friend shared with you, by id — for opening a quote. */
  sharedById: Record<string, SharedActivity>;
  watchMap: WatchMap;
  tagMap: TagMap;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, setPending] = useState<
    Array<{ tempId: string; body: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Quote → detail / copy modals. openQuote carries the activity id + the
  // specific occurrence (date/status) the message quoted.
  const [openQuote, setOpenQuote] = useState<{
    activityId: string;
    occurrence: Occurrence | null;
  } | null>(null);
  const [copying, setCopying] = useState<SharedActivity | null>(null);
  const openShare = openQuote ? sharedById[openQuote.activityId] ?? null : null;

  // Clear optimistic bubbles once the server thread reflects them.
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4">
        {empty ? (
          <p className="mt-8 text-center text-sm text-zinc-500">
            No messages yet. Say hi to {friendName}.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((m) => {
              const activityId = m.quotedActivityId;
              const canOpenQuote =
                activityId !== null && Boolean(sharedById[activityId]);
              return (
                <MessageBubble
                  key={m.id}
                  mine={m.senderId === currentUserId}
                  body={m.body}
                  quotedName={m.quotedActivityName}
                  quotedDate={m.quotedScheduledFor}
                  quotedStatus={m.quotedStatus}
                  onQuoteOpen={
                    canOpenQuote
                      ? () =>
                          setOpenQuote({
                            activityId,
                            occurrence: m.quotedScheduledFor
                              ? {
                                  scheduledFor: m.quotedScheduledFor,
                                  statusLabel: m.quotedStatus ?? "",
                                }
                              : null,
                          })
                      : undefined
                  }
                />
              );
            })}
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

      {openShare && openQuote && (
        <SharedActivityModal
          share={openShare}
          friendId={friendId}
          tagMap={tagMap}
          watch={watchMap[openShare.activityId] ?? NO_WATCH}
          occurrence={openQuote.occurrence}
          onCopy={(s) => setCopying(s)}
          onClose={() => setOpenQuote(null)}
        />
      )}
      {copying && (
        <CopyShareModal
          shared={copying}
          tagMap={tagMap}
          onClose={() => setCopying(null)}
        />
      )}
    </div>
  );
}

function MessageBubble({
  mine,
  body,
  quotedName,
  quotedDate,
  quotedStatus,
  onQuoteOpen,
  sending = false,
}: {
  mine: boolean;
  body: string;
  quotedName?: string | null;
  quotedDate?: string | null;
  quotedStatus?: string | null;
  /** When set, the quote block is tappable and opens the occurrence detail. */
  onQuoteOpen?: () => void;
  sending?: boolean;
}) {
  const quoteCls = `mb-1 block w-full rounded-md border-l-2 px-2 py-1 text-left text-xs ${
    mine
      ? "border-white/40 bg-white/10"
      : "border-zinc-400 bg-black/5 dark:border-zinc-500 dark:bg-white/5"
  }`;
  const quoteInner = (
    <>
      <span className="opacity-70">Re: </span>
      <span className="font-medium">{quotedName}</span>
      {quotedDate && (
        <span className="opacity-70">
          {" "}
          — {quotedDate}
          {quotedStatus ? ` · ${quotedStatus}` : ""}
        </span>
      )}
      {onQuoteOpen && <span className="opacity-70"> ›</span>}
    </>
  );

  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
          mine
            ? "bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
        } ${sending ? "opacity-60" : ""}`}
      >
        {quotedName &&
          (onQuoteOpen ? (
            <button
              type="button"
              onClick={onQuoteOpen}
              className={`${quoteCls} cursor-pointer hover:opacity-80`}
              title="View activity details"
            >
              {quoteInner}
            </button>
          ) : (
            <div className={quoteCls}>{quoteInner}</div>
          ))}
        {body && <p className="whitespace-pre-wrap break-words">{body}</p>}
      </div>
    </li>
  );
}
