"use client";

// ---------------------------------------------------------------------------
// Endless-scroll Year view. Renders a scrollable list of ~25 years
// (±12 from the URL's ?date=), each as a 3-col grid of 12 mini-months
// where each mini-month is a 7-col dot grid.
//
// Data model:
//   - Year data is per-day { pending, completed } counts, not banner
//     names — mini-month cells only need to draw an ink dot when a
//     day had activity. Fetched via fetchYearActivities.
//   - Initial window (initialYear ± YEAR_INITIAL_RADIUS) ships with
//     server-baked data. Farther years lazy-load on scroll.
//
// Scroll + URL + iOS behavior mirrors MonthList. Same pre-hydration
// <script>, same useLayoutEffect + retry loop, same URL sync.
// ---------------------------------------------------------------------------

import {
  addDays,
  addYears,
  endOfMonth,
  format,
  startOfWeek,
} from "date-fns";
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
  fetchYearActivities,
  type YearCountsByDate,
} from "@/app/actions/calendar-fetch";

import { IncompleteButton, type IncompleteInfo } from "./incomplete-button";

const YEAR_WINDOW_BACK = 12;
const YEAR_WINDOW_AHEAD = 12;

// YEAR_INITIAL_RADIUS moved to month-cell.tsx (shared, no "use client")
// so the server-side YearView can import it safely.

// ---------------------------------------------------------------------------

type YearEntry = {
  key: string; // "YYYY-01-01"
  year: number;
};

export function YearList({
  initialYear,
  initialData,
  todayStr,
  incompleteInfo,
  hiddenTags,
  chipsSlot,
}: {
  /** First-of-year string ("YYYY-01-01") the view should land on. */
  initialYear: string;
  /** Server-baked data for the initial window. */
  initialData: Record<string, YearCountsByDate>;
  todayStr: string;
  incompleteInfo: IncompleteInfo;
  hiddenTags: string[];
  chipsSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [, startFetchTransition] = useTransition();

  const initialYearNum = Number(initialYear.slice(0, 4));
  const [currentYear, setCurrentYear] = useState<string>(initialYear);

  const years: YearEntry[] = [];
  for (let i = -YEAR_WINDOW_BACK; i <= YEAR_WINDOW_AHEAD; i++) {
    const y = initialYearNum + i;
    years.push({ key: `${y}-01-01`, year: y });
  }

  const [yearData, setYearData] = useState<Record<string, YearCountsByDate>>(
    initialData
  );
  const inFlightRef = useRef<Set<string>>(new Set());

  const requestYear = useCallback(
    (yearKey: string) => {
      if (yearData[yearKey] !== undefined) return;
      if (inFlightRef.current.has(yearKey)) return;
      inFlightRef.current.add(yearKey);
      startFetchTransition(async () => {
        try {
          const result = await fetchYearActivities(yearKey, hiddenTags);
          setYearData((prev) =>
            prev[yearKey] !== undefined ? prev : { ...prev, [yearKey]: result }
          );
        } finally {
          inFlightRef.current.delete(yearKey);
        }
      });
    },
    [yearData, hiddenTags]
  );

  // URL sync — mirrors MonthList / DayList.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("date") === currentYear) return;
    url.searchParams.set("date", currentYear);
    window.history.replaceState(window.history.state, "", url.toString());
  }, [currentYear]);

  // Topmost-year tracker.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame: number | null = null;
    const update = () => {
      const containerRect = container.getBoundingClientRect();
      const sections =
        container.querySelectorAll<HTMLElement>("[data-year-key]");
      let bestKey: string | null = null;
      let bestTop = Number.POSITIVE_INFINITY;
      for (const sec of sections) {
        const top = sec.getBoundingClientRect().top - containerRect.top;
        if (top >= -10 && top < bestTop) {
          bestTop = top;
          bestKey = sec.getAttribute("data-year-key");
        }
      }
      if (bestKey) {
        setCurrentYear((prev) => (prev === bestKey ? prev : bestKey!));
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

  // Snap-to-initial + iOS retry loop — same shape as MonthList/DayList.
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
    const targetSelector = `[data-year-key="${initialYear}"]`;

    const isTargetAtTop = (): boolean => {
      const target = container.querySelector<HTMLElement>(targetSelector);
      if (!target) return false;
      const rect = target.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return Math.abs(rect.top - containerRect.top) <= 5;
    };

    // Seed with `now` so the pre-hydration inline script's own scroll
    // event doesn't get misclassified as a user scroll.
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
        if (!isTargetAtTop()) doScroll();
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
  }, [initialYear]);

  // Lazy-load year activity data as each year scrolls into view.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const key = entry.target.getAttribute("data-year-key");
          if (key) requestYear(key);
        }
      },
      {
        root: container,
        rootMargin: "600px 0px",
        threshold: 0,
      }
    );
    const sections = container.querySelectorAll("[data-year-key]");
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [requestYear]);

  const jumpYears = (delta: number) => {
    const targetYear = Number(currentYear.slice(0, 4)) + delta;
    const target = `${targetYear}-01-01`;
    const inWindow = years.some((y) => y.key === target);
    if (inWindow) {
      scrollContainerTo(containerRef.current, target);
    } else {
      router.push(`/?view=year&date=${target}`);
    }
  };
  const jumpToday = () => {
    const target = `${todayStr.slice(0, 4)}-01-01`;
    const inWindow = years.some((y) => y.key === target);
    if (inWindow) {
      scrollContainerTo(containerRef.current, target);
    } else {
      router.push(`/?view=year&date=${target}`);
    }
  };

  return (
    // Fill the outer scroll region: header stays put (shrink-0) and only
    // the year body below scrolls (see MonthList for the rationale).
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Header — no drill-up for Year (no parent view). */}
      <div className="relative flex shrink-0 flex-col gap-1">
        <p className="text-center text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {currentYear.slice(0, 4)}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => jumpYears(-1)}
            aria-label="Previous year"
            className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            ←
          </button>
          <input
            type="number"
            value={currentYear.slice(0, 4)}
            min="1970"
            max="2100"
            step="1"
            onChange={(e) => {
              const v = e.target.value;
              if (/^\d{4}$/.test(v)) {
                const target = `${v}-01-01`;
                const inWindow = years.some((y) => y.key === target);
                if (inWindow) {
                  scrollContainerTo(containerRef.current, target);
                } else {
                  router.push(`/?view=year&date=${target}`);
                }
              }
            }}
            className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="button"
            onClick={() => jumpYears(1)}
            aria-label="Next year"
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

      <div
        ref={containerRef}
        data-year-scroll="true"
        style={{ overflowAnchor: "none" }}
        className="min-h-0 flex-1 touch-pan-y overflow-y-auto overflow-x-hidden overscroll-contain pr-2"
      >
        <div className="flex flex-col gap-6">
          {years.map((y) => (
            <YearSection
              key={y.key}
              entry={y}
              counts={yearData[y.key]}
              todayStr={todayStr}
            />
          ))}
        </div>
      </div>
      {/* Server-only pre-hydration scroll anchor — see MonthList for why
          it's wrapped this way (avoids React 19's client <script> warning). */}
      <div hidden suppressHydrationWarning>
        {typeof window === "undefined" && (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var s=document.querySelector('[data-year-key="${initialYear}"]');if(!s)return;var c=s.closest('[data-year-scroll]');if(!c)return;c.scrollTop=s.offsetTop;}catch(e){}})();`,
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function YearSection({
  entry,
  counts,
  todayStr,
}: {
  entry: YearEntry;
  counts: YearCountsByDate | undefined;
  todayStr: string;
}) {
  const months = Array.from({ length: 12 }, (_, m) => ({
    monthIndex: m,
    monthStart: new Date(entry.year, m, 1),
  }));

  const isLoaded = counts !== undefined;

  return (
    <section
      id={`year-${entry.key}`}
      data-year-key={entry.key}
      className="flex flex-col gap-2 scroll-mt-2"
    >
      <h2 className="flex items-baseline gap-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
        <span>{entry.year}</span>
        {!isLoaded && (
          <span className="text-[10px] font-normal normal-case text-zinc-400 dark:text-zinc-600">
            loading…
          </span>
        )}
      </h2>
      <div className="grid grid-cols-3 gap-4">
        {months.map((m) => (
          <MiniMonth
            key={m.monthIndex}
            monthStart={m.monthStart}
            byDate={counts ?? {}}
            todayStr={todayStr}
          />
        ))}
      </div>
    </section>
  );
}

function MiniMonth({
  monthStart,
  byDate,
  todayStr,
}: {
  monthStart: Date;
  byDate: YearCountsByDate;
  todayStr: string;
}) {
  const monthEnd = endOfMonth(monthStart);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const monthDateStr = format(monthStart, "yyyy-MM-dd");
  const monthLabel = monthStart.toLocaleString(undefined, { month: "long" });

  const cells = Array.from({ length: 42 }, (_, i) => {
    const date = addDays(gridStart, i);
    const dateStr = format(date, "yyyy-MM-dd");
    const inMonth = date >= monthStart && date <= monthEnd;
    const c = byDate[dateStr] ?? { pending: 0, completed: 0 };
    return {
      date,
      dateStr,
      inMonth,
      isToday: dateStr === todayStr,
      hasActivity: inMonth && (c.pending > 0 || c.completed > 0),
    };
  });

  return (
    <Link
      href={`/?view=month&date=${monthDateStr}`}
      className="flex flex-col gap-1.5 rounded-md border border-zinc-200 p-2 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
    >
      <h3 className="text-center text-xs font-medium">{monthLabel}</h3>
      <div className="grid grid-cols-7 gap-px">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div
            key={i}
            className="text-center text-[8px] font-medium text-zinc-400"
          >
            {d}
          </div>
        ))}
        {cells.map((c) => (
          <div
            key={c.dateStr}
            className={`flex aspect-square items-center justify-center rounded text-[8px] ${
              !c.inMonth
                ? "text-zinc-200 dark:text-zinc-800"
                : c.hasActivity
                  ? "bg-zinc-900 font-semibold text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "text-zinc-600 dark:text-zinc-400"
            } ${c.isToday ? "ring-1 ring-zinc-900 dark:ring-zinc-50" : ""}`}
          >
            {c.inMonth ? c.date.getDate() : ""}
          </div>
        ))}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------

function scrollContainerTo(
  container: HTMLDivElement | null,
  yearKey: string
) {
  if (!container) return;
  const target = container.querySelector<HTMLElement>(
    `[data-year-key="${yearKey}"]`
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
