"use client";

// ---------------------------------------------------------------------------
// Calendar preview shown below the create-activity form.
//
// As the user changes rhythm + dates, the form pipes the derived rhythm
// here and we render a 5-week grid starting from the Monday of the start
// date's week. Cells that will produce instances are filled; the rest are
// muted. Uses the same `generateInstances()` the server will use, so what
// you see is what you get.
// ---------------------------------------------------------------------------

import { addDays, format, parseISO, startOfWeek } from "date-fns";

import { generateInstances } from "@/lib/domain/rhythms";
import type { Rhythm } from "@/lib/validators/rhythm";

const WINDOW_DAYS = 35; // 5 weeks
const WEEK_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TODAY_STR = new Date().toISOString().slice(0, 10);

export function CalendarPreview({
  rhythm,
  startDate,
  endDate,
}: {
  rhythm: Rhythm | null;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD or null = open-ended
}) {
  if (!rhythm) {
    return (
      <Pane>
        <Header count={null} startDate={startDate} endDate={endDate} />
        <p className="text-xs text-zinc-500">
          Pick a rhythm and the preview will appear here.
        </p>
      </Pane>
    );
  }

  // Window: from startDate, 35 days forward (clamped by endDate if set).
  const from = startDate;
  const startD = parseISO(startDate);
  const windowEndStr = format(addDays(startD, WINDOW_DAYS - 1), "yyyy-MM-dd");
  const effectiveTo =
    endDate && endDate < windowEndStr ? endDate : windowEndStr;

  let instances: ReturnType<typeof generateInstances> = [];
  try {
    instances = generateInstances(rhythm, { from, to: effectiveTo });
  } catch {
    instances = [];
  }
  const instanceDays = new Set(instances.map((i) => i.scheduledFor));

  // Grid: start at Monday of the week containing startDate.
  const gridStart = startOfWeek(startD, { weekStartsOn: 1 });
  const cells = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const date = addDays(gridStart, i);
    const dateStr = format(date, "yyyy-MM-dd");
    return {
      date,
      dateStr,
      inRange:
        dateStr >= startDate && (endDate === null || dateStr <= endDate),
      hasInstance: instanceDays.has(dateStr),
      isToday: dateStr === TODAY_STR,
      isStartDate: dateStr === startDate,
    };
  });

  return (
    <Pane>
      <Header
        count={instances.length}
        startDate={startDate}
        endDate={endDate}
      />
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
          <Cell key={c.dateStr} {...c} />
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm bg-zinc-900 dark:bg-zinc-50 align-middle" />
        Scheduled occurrence ·{" "}
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-zinc-900 align-middle dark:border-zinc-50" />
        Today ·{" "}
        <span className="text-zinc-400">faded</span> = outside start/end window
      </p>
    </Pane>
  );
}

// ---------------------------------------------------------------------------

function Pane({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      {children}
    </div>
  );
}

function Header({
  count,
  startDate,
  endDate,
}: {
  count: number | null;
  startDate: string;
  endDate: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-sm font-medium">Schedule preview</h3>
      <p className="text-xs text-zinc-500">
        {count === null
          ? "—"
          : `${count} occurrence${count === 1 ? "" : "s"} in the next 5 weeks`}
        {endDate && ` · ends ${endDate}`}
        {!endDate && startDate < TODAY_STR && " · started already"}
      </p>
    </div>
  );
}

function Cell({
  date,
  inRange,
  hasInstance,
  isToday,
  isStartDate,
}: {
  date: Date;
  dateStr: string;
  inRange: boolean;
  hasInstance: boolean;
  isToday: boolean;
  isStartDate: boolean;
}) {
  let cls =
    "flex aspect-square items-center justify-center rounded text-xs select-none";
  if (hasInstance) {
    cls +=
      " bg-zinc-900 text-white font-semibold dark:bg-zinc-50 dark:text-zinc-900";
  } else if (inRange) {
    cls += " text-zinc-700 dark:text-zinc-300";
  } else {
    cls += " text-zinc-300 dark:text-zinc-700";
  }
  if (isToday && !hasInstance) {
    cls += " ring-1 ring-zinc-900 dark:ring-zinc-50";
  }
  if (isStartDate && !hasInstance && !isToday) {
    cls += " underline underline-offset-2";
  }

  return <div className={cls}>{date.getDate()}</div>;
}
