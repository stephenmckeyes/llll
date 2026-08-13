"use client";

// ---------------------------------------------------------------------------
// SwipeNav — wraps content and fires prev/next on a horizontal swipe, so
// touch users can flip between periods (e.g. weeks) without reaching for
// the arrow buttons. Swipe RIGHT (finger left→right) = previous; swipe
// LEFT = next, matching iPhone Calendar and standard carousels.
//
// Two ways to navigate, so it works from both server and client callers:
//   - stepView + stepDays → router.push, computing the target from the
//     LIVE URL's ?date= at swipe time (server-rendered Week view). Reading
//     the URL fresh each swipe — rather than precomputed prev/next hrefs —
//     is what makes repeated swipes work: static hrefs baked at render can
//     go stale and every swipe after the first would target the same week.
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
  stepView,
  stepDays,
  onPrev,
  onNext,
  className,
  children,
}: {
  /** view= param to push when stepping via the URL (e.g. "week"). */
  stepView?: string;
  /** Days to shift ?date= by per swipe (e.g. 7 for a week). Both this and
   *  stepView are required for URL stepping. */
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

  const stepFromUrl = (deltaDays: number) => {
    if (typeof window === "undefined" || !stepView) return;
    const cur = new URLSearchParams(window.location.search).get("date");
    if (!cur || !/^\d{4}-\d{2}-\d{2}$/.test(cur)) return;
    router.push(`/?view=${stepView}&date=${shiftYmd(cur, deltaDays)}`);
  };

  const goPrev = () => {
    if (onPrev) onPrev();
    else if (stepDays) stepFromUrl(-stepDays);
  };
  const goNext = () => {
    if (onNext) onNext();
    else if (stepDays) stepFromUrl(stepDays);
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
