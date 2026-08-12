"use client";

// ---------------------------------------------------------------------------
// Endless-scroll Month view. Renders a scrollable list of ~73 months
// (±36 from the URL's ?date=, so ~6 years span). Each month is a
// standard 7×6 grid using MonthCell.
//
// Data strategy:
//   - The initial window (initialMonth ± 3) ships with real activity
//     data from the server (baked into `initialData`). This is what
//     the user first sees, so it can't wait for a client fetch.
//   - The rest of the ±36 window renders empty grids initially. An
//     IntersectionObserver fetches each month's activities on demand
//     when its grid scrolls into view. Result: infinite-feeling scroll,
//     data cost only for what the user actually looks at.
//
// Scroll strategy (mirrors DayList's iOS-safe machinery):
//   - Pre-hydration <script> tag serialized after all months. Runs
//     during initial HTML parse and sets scrollTop before the first
//     paint. No cold-open flash of window edges.
//   - useLayoutEffect + verify-and-retry + ResizeObserver + timers
//     keeps the anchor holding until layout settles, then goes silent
//     the moment the user swipes.
//   - overflow-anchor: none on the scroll container so the browser
//     doesn't shift scroll under us when late-loading months change
//     content size.
//
// URL sync: currentMonth ↔ URL's ?date= via history.replaceState, so
// section-tab clicks and the drill-up "< YYYY" link always target the
// month the user is currently viewing.
// ---------------------------------------------------------------------------

import { addMonths, endOfMonth, format, startOfMonth, startOfWeek } from "date-fns";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import {
  fetchMonthActivities,
  type MonthBannersByDate,
} from "@/app/actions/calendar-fetch";
import type { TagMap } from "@/lib/domain/tags";

import { IncompleteButton, type IncompleteInfo } from "./incomplete-button";
import { MonthCell, type MonthBanner } from "./month-cell";

// How many months in each direction to render as scrollable grids.
// 36 = 3 years each side, comfortable for typical review use cases.
// Client renders empty grids for far months; only visible months pay
// the fetch cost.
const MONTH_WINDOW_BACK = 36;
const MONTH_WINDOW_AHEAD = 36;

// MONTH_INITIAL_RADIUS moved to month-cell.tsx (shared, no "use client")
// so the server-side MonthView can import it safely.

const WEEK_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ---------------------------------------------------------------------------

type MonthEntry = {
  key: string; // "YYYY-MM-01" — first-of-month is our stable id
  monthStart: Date;
  label: string; // "August 2026"
};

export function MonthList({
  initialMonth,
  initialData,
  todayStr,
  incompleteInfo,
  tagMap,
  hiddenTags,
  chipsSlot,
}: {
  /** First-of-month string ("YYYY-MM-01") the view should land on. */
  initialMonth: string;
  /** Server-baked data for the initial window (initialMonth ± MONTH_INITIAL_RADIUS). */
  initialData: Record<string, MonthBannersByDate>;
  todayStr: string;
  incompleteInfo: IncompleteInfo;
  tagMap: TagMap;
  /** Applied to lazy fetches too. */
  hiddenTags: string[];
  chipsSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [, startFetchTransition] = useTransition();

  const initialDateObj = parseLocalDate(initialMonth);
  const [currentMonth, setCurrentMonth] = useState<string>(initialMonth);

  // Rebuild the window each render — cheap (~73 objects).
  const months: MonthEntry[] = [];
  for (let i = -MONTH_WINDOW_BACK; i <= MONTH_WINDOW_AHEAD; i++) {
    const d = startOfMonth(addMonths(initialDateObj, i));
    months.push({
      key: format(d, "yyyy-MM-01"),
      monthStart: d,
      label: format(d, "MMMM yyyy"),
    });
  }

  // Per-month activity map. Starts as the server-baked initialData;
  // grows as IntersectionObserver-triggered fetches complete.
  const [monthData, setMonthData] = useState<Record<string, MonthBannersByDate>>(
    initialData
  );
  // In-flight guard so IntersectionObserver doesn't fire a second
  // fetch for a month whose fetch is already pending.
  const inFlightRef = useRef<Set<string>>(new Set());

  const requestMonth = useCallback(
    (monthKey: string) => {
      if (monthData[monthKey] !== undefined) return;
      if (inFlightRef.current.has(monthKey)) return;
      inFlightRef.current.add(monthKey);
      startFetchTransition(async () => {
        try {
          const result = await fetchMonthActivities(monthKey, hiddenTags);
          setMonthData((prev) =>
            prev[monthKey] !== undefined ? prev : { ...prev, [monthKey]: result }
          );
        } finally {
          inFlightRef.current.delete(monthKey);
        }
      });
    },
    [monthData, hiddenTags]
  );

  // Sync currentMonth into URL. Cold-open protection stays upstream
  // in page.tsx (sec-fetch-site === "none" + stale ?date → redirect
  // to /), so bookmarking a distant month doesn't outlive a fresh
  // session. Uses replaceState — no navigation, no history entry.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("date") === currentMonth) return;
    url.searchParams.set("date", currentMonth);
    window.history.replaceState(window.history.state, "", url.toString());
  }, [currentMonth]);

  // Track which month is visible at the top of the scroll container.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let frame: number | null = null;
    const update = () => {
      const containerRect = container.getBoundingClientRect();
      const sections =
        container.querySelectorAll<HTMLElement>("[data-month-key]");
      let bestKey: string | null = null;
      let bestTop = Number.POSITIVE_INFINITY;
      for (const sec of sections) {
        const top = sec.getBoundingClientRect().top - containerRect.top;
        if (top >= -10 && top < bestTop) {
          bestTop = top;
          bestKey = sec.getAttribute("data-month-key");
        }
      }
      if (bestKey) {
        setCurrentMonth((prev) => (prev === bestKey ? prev : bestKey!));
      }
    };
    const onScroll = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        update();
        frame = null;
      });
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // Snap scroll to initialMonth on mount. Same iOS-safe machinery as
  // DayList: pre-hydration <script> handles the first paint; this
  // useLayoutEffect + retry loop covers subsequent programmatic
  // remounts (e.g. React StrictMode double-invoke, router.push from
  // date arrows).
  const isFirstMountRef = useRef(true);
  useLayoutEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    if (!isFirstMountRef.current) {
      container.scrollTop = 0;
    }
    isFirstMountRef.current = false;

    let settled = false;
    let userTook = false;
    let verifyAttempts = 0;
    const MAX_VERIFY = 20;
    const targetSelector = `[data-month-key="${initialMonth}"]`;

    const isTargetAtTop = (): boolean => {
      const target = container.querySelector<HTMLElement>(targetSelector);
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return Math.abs(rect.top - containerRect.top) <= 5;
    };

    // Seed with `now` so the pre-hydration inline script's own scroll
    // event (fired during HTML parse, delivered on first tick after
    // hydration) doesn't get misclassified as a user scroll and kill
    // the retry loop. Any actual user scroll happens well >200 ms
    // after this seed value.
    let lastProgrammaticScrollAt = performance.now();

    const doScroll = () => {
      if (cancelled || settled || userTook) return;
      const target = container.querySelector<HTMLElement>(targetSelector);
      if (!target) return;
      void container.offsetHeight;
      lastProgrammaticScrollAt = performance.now();
      try {
        target.scrollIntoView({
          block: "start",
          inline: "nearest",
          behavior: "auto",
        });
      } catch {
        /* fall through */
      }
      requestAnimationFrame(() => {
        if (cancelled || userTook) return;
        if (!isTargetAtTop()) {
          const containerRect = container.getBoundingClientRect();
          const rect = target.getBoundingClientRect();
          const top = container.scrollTop + (rect.top - containerRect.top);
          lastProgrammaticScrollAt = performance.now();
          container.scrollTop = top;
        }
        requestAnimationFrame(() => {
          if (cancelled || userTook) return;
          if (isTargetAtTop()) settled = true;
        });
      });
      verifyScroll();
    };

    const verifyScroll = () => {
      if (cancelled || settled || userTook) return;
      if (verifyAttempts >= MAX_VERIFY) return;
      verifyAttempts += 1;
      requestAnimationFrame(() => {
        if (cancelled || userTook) return;
        if (!isTargetAtTop()) {
          doScroll();
        }
      });
    };

    const onScroll = () => {
      if (cancelled) return;
      const dt = performance.now() - lastProgrammaticScrollAt;
      if (dt > 200) userTook = true;
    };
    const onTouch = () => {
      if (cancelled) return;
      userTook = true;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("touchstart", onTouch, { passive: true });
    container.addEventListener("wheel", onTouch, { passive: true });

    if (isFirstMountRef.current === false) doScroll();
    // The scroll from isFirstMount branch above is done via inline
    // script on first mount; call doScroll explicitly here just to
    // verify + kick retries when needed.
    doScroll();
    const raf1 = requestAnimationFrame(() => {
      doScroll();
      requestAnimationFrame(doScroll);
    });

    let lastContentHeight = container.scrollHeight;
    let lastContainerHeight = container.clientHeight;
    const observer = new ResizeObserver(() => {
      if (cancelled || settled || userTook) return;
      const h = container.scrollHeight;
      const c = container.clientHeight;
      if (h !== lastContentHeight || c !== lastContainerHeight) {
        lastContentHeight = h;
        lastContainerHeight = c;
        doScroll();
      }
    });
    observer.observe(container);
    const content = container.firstElementChild;
    if (content) observer.observe(content);

    const timers = [50, 200, 500, 1000, 2000, 4000].map((ms) =>
      setTimeout(() => {
        if (cancelled || settled || userTook) return;
        doScroll();
      }, ms)
    );
    const disconnectTimer = setTimeout(() => observer.disconnect(), 5000);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      timers.forEach(clearTimeout);
      clearTimeout(disconnectTimer);
      observer.disconnect();
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("touchstart", onTouch);
      container.removeEventListener("wheel", onTouch);
    };
  }, [initialMonth]);

  // Lazy-load activity data for each month as it enters the viewport.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const key = entry.target.getAttribute("data-month-key");
          if (key) requestMonth(key);
        }
      },
      {
        root: container,
        // Prefetch a bit ahead of the viewport so the grid populates
        // before the user actually reaches it.
        rootMargin: "300px 0px",
        threshold: 0,
      }
    );
    const sections = container.querySelectorAll("[data-month-key]");
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [requestMonth]);

  const prevMonth = format(
    startOfMonth(addMonths(parseLocalDate(currentMonth), -1)),
    "yyyy-MM-01"
  );
  const nextMonth = format(
    startOfMonth(addMonths(parseLocalDate(currentMonth), 1)),
    "yyyy-MM-01"
  );

  const jumpMonths = (delta: number) => {
    const target = format(
      startOfMonth(addMonths(parseLocalDate(currentMonth), delta)),
      "yyyy-MM-01"
    );
    const inWindow = months.some((m) => m.key === target);
    if (inWindow) {
      scrollContainerTo(containerRef.current, target);
    } else {
      router.push(`/?view=month&date=${target}`);
    }
  };

  const jumpToday = () => {
    const target = format(startOfMonth(parseLocalDate(todayStr)), "yyyy-MM-01");
    const inWindow = months.some((m) => m.key === target);
    if (inWindow) {
      scrollContainerTo(containerRef.current, target);
    } else {
      router.push(`/?view=month&date=${target}`);
    }
  };

  return (
    // Fill the outer scroll region: header stays put (shrink-0) and only
    // the month body below scrolls. min-h-0 lets the flex child shrink
    // below its content height so the inner overflow-y-auto engages.
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Header row — drill-up "< YYYY" on the left, friendly month
          label centered. Mirrors DayList's layout so the two feel
          identical. */}
      <div className="relative flex shrink-0 flex-col gap-1">
        <Link
          href={`/?view=year&date=${currentMonth}`}
          className="absolute left-0 top-0 shrink-0 rounded-md border border-zinc-300 px-2 py-0.5 text-sm font-semibold leading-tight text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
          aria-label={`Go to year view of ${currentMonth.slice(0, 4)}`}
        >
          ‹ {currentMonth.slice(0, 4)}
        </Link>
        <p className="text-center text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {format(parseLocalDate(currentMonth), "MMMM yyyy")}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => jumpMonths(-1)}
            aria-label="Previous month"
            className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            ←
          </button>
          <input
            type="month"
            value={currentMonth.slice(0, 7)}
            onChange={(e) => {
              const v = e.target.value;
              if (/^\d{4}-\d{2}$/.test(v)) {
                const target = `${v}-01`;
                const inWindow = months.some((m) => m.key === target);
                if (inWindow) {
                  scrollContainerTo(containerRef.current, target);
                } else {
                  router.push(`/?view=month&date=${target}`);
                }
              }
            }}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={() => jumpMonths(1)}
            aria-label="Next month"
            className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            →
          </button>
          <button
            type="button"
            onClick={jumpToday}
            className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Today
          </button>
          <IncompleteButton info={incompleteInfo} />
          {chipsSlot && <div className="ml-auto shrink-0">{chipsSlot}</div>}
        </div>
      </div>

      {/* Scrollable list of months. Same height + touch config as
          DayList so both surfaces feel identical.
          overflow-anchor: none so browser scroll-anchoring doesn't
          shift us under late-loading months. */}
      <div
        ref={containerRef}
        data-month-scroll="true"
        style={{ overflowAnchor: "none" }}
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain pr-2"
      >
        <div className="flex flex-col gap-4">
          {months.map((m) => (
            <MonthSection
              key={m.key}
              entry={m}
              banners={monthData[m.key]}
              tagMap={tagMap}
              todayStr={todayStr}
            />
          ))}
        </div>
      </div>
      {/* Pre-hydration scroll anchor. Runs during HTML parse — after
          all month sections are in DOM — and sets scrollTop before
          the first paint so cold-open never flashes a distant month. */}
      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var s=document.querySelector('[data-month-key="${initialMonth}"]');if(!s)return;var c=s.closest('[data-month-scroll]');if(!c)return;c.scrollTop=s.offsetTop;}catch(e){}})();`,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function MonthSection({
  entry,
  banners,
  tagMap,
  todayStr,
}: {
  entry: MonthEntry;
  banners: MonthBannersByDate | undefined;
  tagMap: TagMap;
  todayStr: string;
}) {
  const monthEnd = endOfMonth(entry.monthStart);
  const gridStart = startOfWeek(entry.monthStart, { weekStartsOn: 1 });

  const isLoaded = banners !== undefined;

  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = addDaysUtil(gridStart, i);
    const dateStr = format(date, "yyyy-MM-dd");
    return {
      date,
      dateStr,
      inMonth: date >= entry.monthStart && date <= monthEnd,
      isToday: dateStr === todayStr,
      instances: banners?.[dateStr] ?? ([] as MonthBanner[]),
    };
  });

  return (
    <section
      id={`month-${entry.key}`}
      data-month-key={entry.key}
      className="flex flex-col gap-2 scroll-mt-2"
    >
      <h2 className="flex items-baseline gap-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
        <span>{entry.label}</span>
        {!isLoaded && (
          <span className="text-[10px] font-normal normal-case text-zinc-400 dark:text-zinc-600">
            loading…
          </span>
        )}
      </h2>
      <div className="grid grid-cols-7 gap-1">
        {WEEK_HEADERS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-medium uppercase tracking-wide text-zinc-500"
          >
            {d}
          </div>
        ))}
        {cells.map((c) => (
          <MonthCell key={c.dateStr} {...c} tagMap={tagMap} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function scrollContainerTo(
  container: HTMLDivElement | null,
  monthKey: string
) {
  if (!container) return;
  const target = container.querySelector<HTMLElement>(
    `[data-month-key="${monthKey}"]`
  );
  if (!target) return;
  const containerTop = container.getBoundingClientRect().top;
  const targetTop = target.getBoundingClientRect().top;
  const top = container.scrollTop + (targetTop - containerTop);
  try {
    container.scrollTo({ top, behavior: "smooth" });
  } catch {
    container.scrollTop = top;
  }
}

function parseLocalDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDaysUtil(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
