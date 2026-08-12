"use client";

// ---------------------------------------------------------------------------
// SwipeNav — wraps content and fires prev/next on a horizontal swipe, so
// touch users can flip between periods (e.g. weeks) without reaching for
// the arrow buttons. Swipe RIGHT (finger left→right) = previous; swipe
// LEFT = next, matching iPhone Calendar and standard carousels.
//
// Two ways to navigate, so it works from both server and client callers:
//   - prevHref / nextHref → router.push (server-rendered Week view, which
//     drives the week off the URL's ?date=).
//   - onPrev / onNext callbacks → local state (the friend Week view, which
//     keeps the reference date in React state).
//
// We only read touch coordinates on touchend and never preventDefault, so
// vertical scrolling is untouched — a gesture only counts when it's clearly
// horizontal (dominates the vertical drift and clears a small threshold).
// A real swipe moves far enough that the browser suppresses the trailing
// click, so tapping a day cell inside still works.
// ---------------------------------------------------------------------------

import { useRouter } from "next/navigation";
import { useRef, type ReactNode } from "react";

// Minimum horizontal travel (px) to count as a swipe.
const SWIPE_MIN_X = 50;

export function SwipeNav({
  prevHref,
  nextHref,
  onPrev,
  onNext,
  className,
  children,
}: {
  /** Navigated to on a swipe RIGHT. Ignored if onPrev is given. */
  prevHref?: string;
  /** Navigated to on a swipe LEFT. Ignored if onNext is given. */
  nextHref?: string;
  /** Called on a swipe RIGHT (takes precedence over prevHref). */
  onPrev?: () => void;
  /** Called on a swipe LEFT (takes precedence over nextHref). */
  onNext?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const start = useRef<{ x: number; y: number } | null>(null);

  const goPrev = () => {
    if (onPrev) onPrev();
    else if (prevHref) router.push(prevHref);
  };
  const goNext = () => {
    if (onNext) onNext();
    else if (nextHref) router.push(nextHref);
  };

  return (
    <div
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
