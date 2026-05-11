"use client";

// ---------------------------------------------------------------------------
// Calendar preview shown below the create-activity form.
//
// As the user changes name + rhythm + dates, the form pipes the derived
// rhythm and the activity name here. We render a 5-week grid starting from
// the Monday of the start date's week. Each scheduled day fills with a
// dark cell + the activity name as a small banner — so you literally see
// what's about to land on your calendar.
//
// FUTURE (per user backlog): when multiple activities can be previewed at
// once, group banners by tag and collapse overflow as "+N more."
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
  activityName,
}: {
  rhythm: Rhythm | null;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD or null = open-ended
  activityName: string;
}) {
  // Guard: a date input mid-edit can hand us "" or partial strings like
  // "2026-05-" — these used to bubble Invalid Date through addDays/format
  // and crash the whole page. If start date isn't a clean YYYY-MM-DD, just
  // render a placeholder.
  if (!isValidDateString(startDate)) {
    return (
      <Pane>
        <Header count={null} endDate={endDate} startedAlready={false} />
        <p className="text-xs text-zinc-500">
          Finish entering a start date to see the preview.
        </p>
      </Pane>
    );
  }

  if (!rhythm) {
    return (
      <Pane>
        <Header count={null} endDate={endDate} startedAlready={false} />
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

  const trimmedName = activityName.trim();

  return (
    <Pane>
      <Header
        count={instances.length}
        endDate={endDate}
        startedAlready={!endDate && startDate < TODAY_STR}
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
          <Cell key={c.dateStr} {...c} activityName={trimmedName} />
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-zinc-900 align-middle dark:bg-zinc-50" />
        Scheduled ·{" "}
        <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-zinc-900 align-middle dark:border-zinc-50" />
        Today ·{" "}
        <span className="text-zinc-400">faded</span> = outside window
      </p>
    </Pane>
  );
}

// ---------------------------------------------------------------------------

function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = parseISO(s);
  return !Number.isNaN(d.getTime());
}

function Pane({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      {children}
    </div>
  );
}

function Header({
  count,
  endDate,
  startedAlready,
}: {
  count: number | null;
  endDate: string | null;
  startedAlready: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-sm font-medium">Schedule preview</h3>
      <p className="text-xs text-zinc-500">
        {count === null
          ? "—"
          : `${count} occurrence${count === 1 ? "" : "s"} in the next 5 weeks`}
        {endDate && ` · ends ${endDate}`}
        {startedAlready && " · started already"}
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
  activityName,
}: {
  date: Date;
  dateStr: string;
  inRange: boolean;
  hasInstance: boolean;
  isToday: boolean;
  isStartDate: boolean;
  activityName: string;
}) {
  let cls =
    "flex aspect-square flex-col items-start gap-0.5 rounded p-1 text-[10px] leading-tight overflow-hidden select-none";

  if (hasInstance) {
    cls +=
      " bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900";
  } else if (inRange) {
    cls += " text-zinc-700 dark:text-zinc-300";
  } else {
    cls += " text-zinc-300 dark:text-zinc-700";
  }
  if (isToday && !hasInstance) cls += " ring-1 ring-zinc-900 dark:ring-zinc-50";
  if (isStartDate && !hasInstance && !isToday) cls += " underline underline-offset-2";

  return (
    <div className={cls} title={hasInstance ? `${activityName || "Activity"} — ${date.toDateString()}` : date.toDateString()}>
      <span className={hasInstance ? "font-semibold" : ""}>{date.getDate()}</span>
      {hasInstance && activityName && (
        <span className="line-clamp-2 w-full break-words text-[9px] font-medium opacity-90">
          {activityName}
        </span>
      )}
    </div>
  );
}
