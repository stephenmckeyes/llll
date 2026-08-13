"use client";

// ---------------------------------------------------------------------------
// SwipeNav — wraps content and fires prev/next on a horizontal swipe. Swipe
// RIGHT (finger left→right) = previous; swipe LEFT = next.
//
// Two ways to navigate:
//   - clickNav → on swipe, programmatically CLICK the real prev/next arrow
//     button (the <Link data-datenav="prev|next"> rendered by DateNavigator).
//     This does the EXACT same thing as tapping the button — no router.push,
//     no stale URL, no re-render dependence — so repeated swipes just work.
//   - onPrev / onNext callbacks → the friend Week view, which keeps the
//     reference date in local React state.
//
// We never preventDefault, so vertical scrolling is untouched — a gesture
// only counts when it's clearly horizontal (dominates the vertical drift and
// clears a small threshold). A real swipe moves far enough that the browser
// suppresses the trailing click, so tapping a day cell inside still works.
// ---------------------------------------------------------------------------

import { useRef, type ReactNode } from "react";

// Minimum horizontal travel (px) to count as a swipe.
const SWIPE_MIN_X = 50;

export function SwipeNav({
  clickNav = false,
  onPrev,
  onNext,
  className,
  children,
}: {
  /** On swipe, click the real DateNavigator prev/next arrow button. */
  clickNav?: boolean;
  /** Called on a swipe RIGHT (takes precedence over clickNav). */
  onPrev?: () => void;
  /** Called on a swipe LEFT (takes precedence over clickNav). */
  onNext?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const goPrev = () => {
    if (onPrev) onPrev();
    else if (clickNav) clickDateNav(ref.current, "prev");
  };
  const goNext = () => {
    if (onNext) onNext();
    else if (clickNav) clickDateNav(ref.current, "next");
  };

  return (
    <div
      ref={ref}
      className={className}
      onTouchStart={(e) => {
        const t = e.changedTouches[0];
        start.current = { x: t.clientX, y: t.clientY };
      }}
      onTouchEnd={(e) => {
        const s = start.current;
        start.current = null;
        if (!s) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        // Ignore taps and mostly-vertical (scroll) gestures.
        if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dx) <= Math.abs(dy)) return;
        if (dx < 0) goNext();
        else goPrev();
      }}
    >
      {children}
    </div>
  );
}

// Click the DateNavigator's real prev/next arrow — a Next <Link>, so a
// programmatic click runs the exact same client navigation as tapping it.
function clickDateNav(scope: HTMLElement | null, dir: "prev" | "next") {
  const doc = scope?.ownerDocument;
  doc?.querySelector<HTMLElement>(`[data-datenav="${dir}"]`)?.click();
}
