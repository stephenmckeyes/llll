"use client";

// ---------------------------------------------------------------------------
// Client-side preference: whether to show the "this is scheduled in the future
// — mark it anyway?" confirmation when completing/missing a future-dated
// occurrence. Defaults to ON (confirm). localStorage-backed via
// useSyncExternalStore, same pattern as the time-format + theme prefs, so a
// change in Settings takes effect everywhere without a navigation.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "mission-confirm-future";
const CHANGE_EVENT = "mission:confirm-future-changed";

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

// Default ON: only an explicit "off" disables the confirmation.
function readSnapshot(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function serverSnapshot(): boolean {
  return true;
}

export function useConfirmFutureComplete(): boolean {
  return useSyncExternalStore(subscribe, readSnapshot, serverSnapshot);
}

export function setConfirmFutureClient(on: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // localStorage disabled — silently ignore.
  }
}
