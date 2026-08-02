"use client";

// ---------------------------------------------------------------------------
// CalendarSync — Settings → Appearance section that manages the
// per-profile ICS export token (migration 0025).
//
// Two states:
//   1. Disabled (no token): a single "Enable calendar sync" button that
//      mints a random token and reveals the URL below.
//   2. Enabled (token present): the subscription URL + Copy / webcal://
//      /  Disable / Rotate buttons. Rotate invalidates every existing
//      subscription without needing to disable first.
//
// The URL uses the browser's window.location.origin so it's correct in
// dev, preview, and production without an env var.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import {
  disableIcsToken,
  enableIcsToken,
} from "@/app/actions/appearance";

export function CalendarSync({
  initialToken,
}: {
  initialToken: string | null;
}) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Compose the URL from the browser origin so dev / preview / prod
  // "just work" without a NEXT_PUBLIC_BASE_URL. The path matches the
  // route handler at app/api/calendar/[token]/route.ts.
  const httpsUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/api/calendar/${token}`
      : null;
  // webcal:// is the iOS/macOS Calendar auto-subscribe scheme. Some
  // clients honor http/https equally; iOS specifically prefers webcal
  // for "subscribe" links.
  const webcalUrl =
    token && typeof window !== "undefined"
      ? httpsUrl!.replace(/^https?:/, "webcal:")
      : null;

  function enable() {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const res = await enableIcsToken();
      if ("error" in res) {
        setError(res.error);
      } else {
        setToken(res.token);
      }
    });
  }

  function disable() {
    if (isPending) return;
    const ok = window.confirm(
      "Disable calendar sync? Every subscribed calendar app will stop " +
        "receiving updates. You can re-enable later with a fresh URL."
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const res = await disableIcsToken();
      if ("error" in res) {
        setError(res.error);
      } else {
        setToken(null);
      }
    });
  }

  function rotate() {
    if (isPending) return;
    const ok = window.confirm(
      "Rotate the calendar URL? Every existing subscription stops " +
        "receiving updates until you re-subscribe with the new URL."
    );
    if (!ok) return;
    setError(null);
    // enableIcsToken() unconditionally regenerates.
    startTransition(async () => {
      const res = await enableIcsToken();
      if ("error" in res) {
        setError(res.error);
      } else {
        setToken(res.token);
      }
    });
  }

  function copyUrl() {
    if (!httpsUrl) return;
    navigator.clipboard.writeText(httpsUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        setError("Couldn't copy — copy manually from the box above.");
      }
    );
  }

  if (!token) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Subscribe from Apple Calendar, Google Calendar, Outlook, or
          any app that reads iCal feeds. Read-only — completions and
          edits made in the calendar app do not sync back.
        </p>
        <button
          type="button"
          onClick={enable}
          disabled={isPending}
          className="self-start rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? "Enabling…" : "Enable calendar sync"}
        </button>
        {error && (
          <p
            role="alert"
            className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Paste this URL into your calendar app to subscribe. Read-only —
        events reflect the last ~30 days plus the next ~180.
      </p>

      {/* Subscription URL — user-selectable + read-only so accidental
          taps don't mangle it. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          readOnly
          value={httpsUrl ?? ""}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="button"
          onClick={copyUrl}
          disabled={isPending}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {webcalUrl && (
          <a
            href={webcalUrl}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Open in Calendar app
          </a>
        )}
      </div>

      {/* Per-app how-to — kept terse so it doesn't dominate the section. */}
      <details className="text-xs text-zinc-600 dark:text-zinc-400">
        <summary className="cursor-pointer font-medium">
          How to subscribe
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <strong>iOS / macOS</strong>: tap “Open in Calendar app”, or
            in Settings → Calendar → Accounts → Add → Other → Subscribed
            Calendar, paste the URL.
          </li>
          <li>
            <strong>Google Calendar</strong>: Other calendars → + → From
            URL, paste the URL.
          </li>
          <li>
            <strong>Outlook</strong>: Add calendar → Subscribe from web,
            paste the URL.
          </li>
        </ul>
      </details>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={rotate}
          disabled={isPending}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Rotate URL
        </button>
        <button
          type="button"
          onClick={disable}
          disabled={isPending}
          className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
        >
          Disable
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
