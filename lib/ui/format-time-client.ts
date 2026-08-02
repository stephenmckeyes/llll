"use client";

// ---------------------------------------------------------------------------
// Client-side time-format hook. Reads from localStorage synchronously via
// useSyncExternalStore (same pattern the theme toggle uses) so mounted
// components pick up a preference change without a navigation, and there's
// no flash of the wrong locale on first paint.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";

import { isTimeFormat, type TimeFormat } from "./format-time";

const STORAGE_KEY = "mission-time-format";
const CHANGE_EVENT = "mission:time-format-changed";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  const onChange = () => cb();
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function readSnapshot(): TimeFormat {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isTimeFormat(raw) ? raw : "auto";
  } catch {
    return "auto";
  }
}

function serverSnapshot(): TimeFormat {
  return "auto";
}

export function useTimeFormat(): TimeFormat {
  return useSyncExternalStore(subscribe, readSnapshot, serverSnapshot);
}

/**
 * Called by the settings picker (or by the layout's pre-hydration script)
 * after a successful server save so any mounted `useTimeFormat` consumers
 * re-read the value immediately. Persistence to the profile is a
 * separate server-action call.
 */
export function setTimeFormatClient(next: TimeFormat) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // localStorage disabled — silently ignore.
  }
}
