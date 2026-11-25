"use client";

// ---------------------------------------------------------------------------
// Client-side preference: how long activity titles render on the calendar.
//   'truncate' (default) — one line, cut off with "…" (unchanged behavior)
//   'wrap'               — full title, wrapped onto as many lines as needed
//   'shrink'             — smaller font so more fits, wrapping if still long
//
// Applied as a `data-title-display` attribute on <html> (set pre-paint by the
// <head> script in app/layout.tsx and re-asserted by ThemeApplier) and styled
// in globals.css via the `.activity-title` class. Going through CSS rather
// than a React hook means server-rendered surfaces (Week/Month banners) and
// the friend / community calendars all honor it with no prop threading.
// localStorage-backed like the theme / time-format / confirm-future prefs.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";

export const TITLE_DISPLAY_KEY = "mission-title-display";
const CHANGE_EVENT = "mission:title-display-changed";

export type TitleDisplay = "truncate" | "wrap" | "shrink";

export function isTitleDisplay(v: unknown): v is TitleDisplay {
  return v === "truncate" || v === "wrap" || v === "shrink";
}

function readSnapshot(): TitleDisplay {
  if (typeof window === "undefined") return "truncate";
  try {
    const v = window.localStorage.getItem(TITLE_DISPLAY_KEY);
    return isTitleDisplay(v) ? v : "truncate";
  } catch {
    return "truncate";
  }
}

/** Mirror the saved preference onto <html> so the CSS applies. */
export function applyTitleDisplay() {
  if (typeof document === "undefined") return;
  const v = readSnapshot();
  if (v === "truncate") document.documentElement.removeAttribute("data-title-display");
  else document.documentElement.setAttribute("data-title-display", v);
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === TITLE_DISPLAY_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, cb);
  };
}

export function useTitleDisplay(): TitleDisplay {
  return useSyncExternalStore(subscribe, readSnapshot, () => "truncate");
}

export function setTitleDisplayClient(v: TitleDisplay) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TITLE_DISPLAY_KEY, v);
  } catch {
    // localStorage disabled — still apply for this page view below.
  }
  if (v === "truncate") document.documentElement.removeAttribute("data-title-display");
  else document.documentElement.setAttribute("data-title-display", v);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
