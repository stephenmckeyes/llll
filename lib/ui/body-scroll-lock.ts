// ---------------------------------------------------------------------------
// useBodyScrollLock — ref-counted body scroll-lock for modals.
//
// Why: every modal in the app needs to suppress page scroll while it's
// open so the user doesn't accidentally scroll the dimmed background.
// The naive pattern in each modal:
//
//   useEffect(() => {
//     const prev = document.body.style.overflow;
//     document.body.style.overflow = "hidden";
//     return () => { document.body.style.overflow = prev; };
//   }, []);
//
// breaks when modals nest. Modal A sets overflow to "hidden", captures
// prev = "" (the initial state). Modal B mounts on top and captures
// prev = "hidden" (Modal A's set value). When the user dismisses
// Modal A first, its cleanup restores prev = "". But Modal B is still
// open. The user dismisses Modal B → its cleanup restores prev =
// "hidden". Body is stuck. Page is unscrollable.
//
// This module owns the global "how many modals want scroll locked"
// counter. The lock is applied only when the count goes 0→1, and
// released only when the count goes 1→0. Stacking is safe.
//
// Bonus: also restores scroll if every modal unmounts and the count
// drops to 0 — so even if React's StrictMode double-mounts in dev
// or HMR fires mid-lock, the page can scroll again.
// ---------------------------------------------------------------------------

import { useEffect } from "react";

let lockCount = 0;
let savedOverflow = "";

function lock() {
  if (typeof document === "undefined") return;
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;
}

function unlock() {
  if (typeof document === "undefined") return;
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = savedOverflow;
  }
}

/** Hook that locks body scroll for the lifetime of the calling
 *  component. Use it from every modal that wants to suppress
 *  background scroll. */
export function useBodyScrollLock() {
  useEffect(() => {
    lock();
    return unlock;
  }, []);
}
