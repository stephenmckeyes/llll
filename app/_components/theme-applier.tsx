"use client";

// ---------------------------------------------------------------------------
// ThemeApplier — re-asserts the saved theme on the client.
//
// The pre-hydration <script> in layout.tsx applies the theme classes to
// <html> before first paint. But after a deploy (stale cached HTML vs. new
// JS), React can fall back to a full client render and reset <html>'s
// className — dropping the `dark` / `sleep` classes while localStorage still
// says "sleep". Symptom: the app looks Light but Settings shows Sleep
// selected, and you have to re-click Sleep to reapply it.
//
// This component re-applies the saved theme on mount (and on cross-tab /
// same-tab changes), so the visual theme always matches localStorage even if
// React reset <html>. Renders nothing.
// ---------------------------------------------------------------------------

import { useEffect } from "react";

const STORAGE_KEY = "mission-theme";
const THEME_CHANGE_EVENT = "mission-theme-changed";

function applySavedTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || "system";
    const root = document.documentElement;
    const prefersDark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark =
      saved === "dark" || saved === "sleep" || (saved === "system" && prefersDark);
    root.classList.toggle("dark", dark);
    root.classList.toggle("sleep", saved === "sleep");
    // Mirror the saved theme into a cookie so the SERVER can render the
    // theme class on the next load (killing the flash). Existing users who
    // only have localStorage get their cookie set here on first load.
    document.cookie = `${STORAGE_KEY}=${saved}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // localStorage blocked (privacy mode) — leave whatever the <head>
    // script applied.
  }
}

export function ThemeApplier() {
  useEffect(() => {
    applySavedTheme();
    // Keep in sync if the theme changes in another tab (storage) or this
    // tab (the picker's custom event).
    window.addEventListener("storage", applySavedTheme);
    window.addEventListener(THEME_CHANGE_EVENT, applySavedTheme);
    return () => {
      window.removeEventListener("storage", applySavedTheme);
      window.removeEventListener(THEME_CHANGE_EVENT, applySavedTheme);
    };
  }, []);
  return null;
}
