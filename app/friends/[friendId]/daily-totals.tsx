// ---------------------------------------------------------------------------
// FriendDailyTotals — a friend's per-day completion count (#/#), shown when
// they've shared their daily total with you (migration 0079). Aggregate only:
// no activities, just the numbers. Presentational / server-rendered.
// ---------------------------------------------------------------------------

import type { FriendDailyTotal } from "@/app/actions/sharing";

function pct(c: number, t: number): number {
  return t > 0 ? Math.round((c / t) * 100) : 0;
}

export function FriendDailyTotals({
  totals,
  todayStr,
  friendName,
}: {
  totals: FriendDailyTotal[];
  todayStr: string;
  friendName: string;
}) {
  if (totals.length === 0) return null;

  const byDay = new Map(totals.map((t) => [t.day, t]));
  const today = byDay.get(todayStr);

  // Last 7 days ending today (most recent first), only days that exist.
  const recent: FriendDailyTotal[] = totals
    .filter((t) => t.day <= todayStr)
    .slice(-7)
    .reverse();

  return (
    <section className="flex flex-col gap-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Daily total
        </h2>
        <span className="text-xs text-zinc-400">shared count only</span>
      </div>

      {today ? (
        <p className="text-2xl font-semibold tracking-tight">
          {today.completed}
          <span className="text-zinc-400">/{today.total}</span>{" "}
          <span className="align-middle text-sm font-normal text-zinc-500">
            today ({pct(today.completed, today.total)}%)
          </span>
        </p>
      ) : (
        <p className="text-sm text-zinc-500">
          Nothing scheduled for {friendName} today.
        </p>
      )}

      {recent.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {recent.map((d) => {
            const done = d.completed >= d.total && d.total > 0;
            return (
              <li
                key={d.day}
                title={`${d.day}: ${d.completed}/${d.total}`}
                className={`rounded-md px-2 py-1 text-xs font-medium tabular-nums ${
                  done
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                }`}
              >
                {d.day === todayStr ? "Today" : d.day.slice(5)} {d.completed}/
                {d.total}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
