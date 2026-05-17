"use client";

// ---------------------------------------------------------------------------
// Reminders editor — one form section, reused by the create form and the
// edit-activity modal. Renders a list of {days, hours, minutes} rows the
// user can add / remove. Each row emits three FormData entries:
//   - reminderDays, reminderHours, reminderMinutes
// The server zips them by index (see parseRemindersFromForm).
// ---------------------------------------------------------------------------

import type { Reminder } from "@/lib/validators/reminder";

export function RemindersField({
  reminders,
  setReminders,
  legendClassName,
  helperClassName,
}: {
  reminders: Reminder[];
  setReminders: (next: Reminder[]) => void;
  legendClassName?: string;
  helperClassName?: string;
}) {
  function update(i: number, patch: Partial<Reminder>) {
    setReminders(
      reminders.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    );
  }
  function addReminder() {
    setReminders([
      ...reminders,
      { days: 0, hours: 0, minutes: 30 },
    ]);
  }
  function removeReminder(i: number) {
    setReminders(reminders.filter((_, idx) => idx !== i));
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={legendClassName ?? "text-sm font-medium"}>
        Reminders
      </legend>
      {reminders.length === 0 ? (
        <p className={helperClassName ?? "text-xs text-zinc-500"}>
          None. Click below to add one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reminders.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              {/* Hidden inputs carry the controlled values into FormData. */}
              <input type="hidden" name="reminderDays" value={r.days} />
              <input type="hidden" name="reminderHours" value={r.hours} />
              <input type="hidden" name="reminderMinutes" value={r.minutes} />

              <DurationInput
                label="d"
                title="Days"
                value={r.days}
                max={30}
                onChange={(n) => update(i, { days: n })}
              />
              <span className="text-zinc-400">:</span>
              <DurationInput
                label="h"
                title="Hours"
                value={r.hours}
                max={23}
                onChange={(n) => update(i, { hours: n })}
              />
              <span className="text-zinc-400">:</span>
              <DurationInput
                label="m"
                title="Minutes"
                value={r.minutes}
                max={59}
                onChange={(n) => update(i, { minutes: n })}
              />
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                before
              </span>
              <button
                type="button"
                onClick={() => removeReminder(i)}
                className="touch-manipulation rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={addReminder}
        disabled={reminders.length >= 10}
        className="touch-manipulation self-start rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        + Add reminder{reminders.length >= 10 ? " (max 10)" : ""}
      </button>
    </fieldset>
  );
}

function DurationInput({
  label,
  title,
  value,
  max,
  onChange,
}: {
  label: string;
  title: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        title={title}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isFinite(n)) {
            onChange(0);
            return;
          }
          onChange(Math.min(Math.max(n, 0), max));
        }}
        className="w-14 rounded-md border border-zinc-300 bg-white px-2 py-1 text-right text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
      />
      <span className="text-xs text-zinc-500">{label}</span>
    </span>
  );
}

// Human-readable summary: "1d 2h 30m before" / "30m before" / "At time"
export function formatReminder(r: Reminder): string {
  const parts: string[] = [];
  if (r.days > 0) parts.push(`${r.days}d`);
  if (r.hours > 0) parts.push(`${r.hours}h`);
  if (r.minutes > 0) parts.push(`${r.minutes}m`);
  if (parts.length === 0) return "At time of occurrence";
  return `${parts.join(" ")} before`;
}
