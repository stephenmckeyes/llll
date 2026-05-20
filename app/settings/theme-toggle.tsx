"use client";

// ---------------------------------------------------------------------------
// ThemeToggle — four-way picker for the Settings page.
//
//   System  — follow OS preference (default)
//   Light   — force light
//   Dark    — force dark
//   Sleep   — force dark + warm/red tint (low-blue-light night mode)
//
// State lives in localStorage under "mission-theme". The pre-hydration
// script in app/layout.tsx reads the same key to apply the right
// classes BEFORE React renders, so changing the picker here doesn't
// cause a theme-flash on next page load.
//
// We also subscribe to OS dark-mode changes while the user is on the
// "System" preference, so flipping the OS toggle propagates without
// reload.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useSyncExternalStore } from "react";

type ThemeMode = "system" | "light" | "dark" | "sleep";

const STORAGE_KEY = "mission-theme";
const THEME_CHANGE_EVENT = "mission-theme-changed";

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia(
    "(prefers-color-scheme: dark)"
  ).matches;
  const dark =
    mode === "dark" ||
    mode === "sleep" ||
    (mode === "system" && prefersDark);
  root.classList.toggle("dark", dark);
  root.classList.toggle("sleep", mode === "sleep");
}

function isValidMode(v: unknown): v is ThemeMode {
  return v === "system" || v === "light" || v === "dark" || v === "sleep";
}

// Subscribe to localStorage's "mission-theme" key + our own
// THEME_CHANGE_EVENT (cross-tab + in-tab change notification).
function subscribe(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", cb);
  window.addEventListener(THEME_CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(THEME_CHANGE_EVENT, cb);
  };
}

function getClientSnapshot(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return isValidMode(raw) ? raw : "system";
}

// Server snapshot is intentionally "system" so the SSR render has a
// stable selection. The pre-hydration script in layout.tsx has already
// applied the correct theme class to <html> before React renders, so
// the visual theme is right; only the "selected" tile shimmer might
// disagree on first paint, which is invisible.
function getServerSnapshot(): ThemeMode {
  return "system";
}

export function ThemeToggle() {
  // useSyncExternalStore is the React-19-blessed way to bridge an
  // external mutable source (localStorage) into a component. Replaces
  // the older useState + useEffect("read on mount") pattern, which the
  // lint rule flags because setState-in-effect causes a cascading
  // render.
  const mode = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot
  );

  // When the user is on "system", listen for OS dark-mode flips so the
  // page tracks them live (the pre-hydration script handles initial
  // load; this handles in-session changes).
  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  const pick = useCallback((next: ThemeMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Quota / privacy mode — still apply the visual change, just
      // don't persist it.
    }
    // Fire our same-tab event so useSyncExternalStore re-reads. The
    // browser's `storage` event only fires across DIFFERENT tabs.
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    applyTheme(next);
  }, []);

  const options: Array<{ value: ThemeMode; label: string; hint: string }> = [
    { value: "system", label: "System", hint: "Match your OS preference." },
    { value: "light", label: "Light", hint: "Bright background, dark text." },
    { value: "dark", label: "Dark", hint: "Dark background, light text." },
    {
      value: "sleep",
      label: "Sleep",
      hint: "Dark + warm filter. Minimizes blue light for evenings.",
    },
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => {
        // `mode` always has a value (useSyncExternalStore's
        // getServerSnapshot returns "system"). On the client's first
        // paint the snapshot already reflects localStorage, so the
        // selected tile is correct without a flicker.
        const selected = mode === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => pick(o.value)}
            aria-pressed={selected}
            className={`flex flex-col items-start gap-1 rounded-md border px-3 py-3 text-left transition-colors ${
              selected
                ? "border-zinc-900 bg-zinc-100 dark:border-zinc-50 dark:bg-zinc-900"
                : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            }`}
          >
            <span className="text-sm font-medium">{o.label}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {o.hint}
            </span>
          </button>
        );
      })}
    </div>
  );
}
