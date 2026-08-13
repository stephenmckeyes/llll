"use client";

// ---------------------------------------------------------------------------
// SwipeNav — wraps content and fires prev/next on a horizontal swipe, so
// touch users can flip between periods (e.g. weeks) without reaching for
// the arrow buttons. Swipe RIGHT (finger left→right) = previous; swipe
// LEFT = next, matching iPhone Calendar and standard carousels.
//
// Two ways to navigate, so it works from both server and client callers:
//   - baseDate + stepView + stepDays → router.push (server-rendered Week
//     view). We DON'T read the URL back between swipes: router.push defers
//     the URL update, so a second swipe would re-read the old ?date= and
//     re-navigate to the same week ("only works once"). Instead we keep a
//     local day-offset from baseDate and step it each swipe. The offset
//     resets whenever baseDate changes (a navigation committed new props),
//     so it's correct whether or not the server re-rendered between swipes.
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
import { useRef, useState, type ReactNode } from "react";

// Minimum horizontal travel (px) to count as a swipe.
const SWIPE_MIN_X = 50;

export function SwipeNav({
  baseDate,
  stepView,
  stepDays,
  onPrev,
  onNext,
  className,
  children,
}: {
  /** Current reference date (YYYY-MM-DD) the view is showing. Required
   *  (with stepView + stepDays) for URL stepping. */
  baseDate?: string;
  /** view= param to push when stepping (e.g. "week"). */
  stepView?: string;
  /** Days to shift by per swipe (e.g. 7 for a week). */
  stepDays?: number;
  /** Called on a swipe RIGHT (takes precedence over URL stepping). */
  onPrev?: () => void;
  /** Called on a swipe LEFT (takes precedence over URL stepping). */
  onNext?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const start = useRef<{ x: number; y: number } | null>(null);

  // Accumulated day-offset from baseDate. Reset when baseDate changes so
  // each swipe steps exactly one period from where we currently are —
  // independent of when router.push commits the URL. (React's "adjust
  // state during render on prop change" pattern.)
  const [snapshot, setSnapshot] = useState(baseDate);
  const [offsetDays, setOffsetDays] = useState(0);
  if (snapshot !== baseDate) {
    setSnapshot(baseDate);
    setOffsetDays(0);
  }

  const stepUrl = (deltaDays: number) => {
    if (!baseDate || !stepView) return;
    const next = offsetDays + deltaDays;
    setOffsetDays(next);
    router.push(`/?view=${stepView}&date=${shiftYmd(baseDate, next)}`);
  };

  const goPrev = () => {
    if (onPrev) onPrev();
    else if (stepDays) stepUrl(-stepDays);
  };
  const goNext = () => {
    if (onNext) onNext();
    else if (stepDays) stepUrl(stepDays);
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

// Shift a YYYY-MM-DD by N days using LOCAL date math (no UTC drift).
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
