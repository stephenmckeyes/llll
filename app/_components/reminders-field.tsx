"use client";

// ---------------------------------------------------------------------------
// Reminders editor — one form section, reused by the create form and the
// edit-activity modal. Renders a list of {amount, unit} rows the user can
// add / remove. Each row emits two hidden FormData entries:
//   - reminderAmount (number string)
//   - reminderUnit   (minutes | hours | days | weeks)
// The server zips them by index back into Reminder[] (see parseRemindersFromForm).
// ---------------------------------------------------------------------------

import type { Reminder, ReminderUnit } from "@/lib/validators/reminder";

const UNIT_OPTIONS: ReadonlyArray<{ value: ReminderUnit; label: string }> = [
  { value: "minutes", label: "minutes" },
  { value: "hours", label: "hours" },
  { value: "days", label: "days" },
  { value: "weeks", label: "weeks" },
];

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
  function updateAmount(i: number, raw: string) {
    const amount = Math.max(1, Math.min(999, parseInt(raw, 10) || 1));
    setReminders(reminders.map((r, idx) => (idx === i ? { ...r, amount } : r)));
  }
  function updateUnit(i: number, unit: ReminderUnit) {
    setReminders(reminders.map((r, idx) => (idx === i ? { ...r, unit } : r)));
  }
  function addReminder() {
    setReminders([...reminders, { amount: 30, unit: "minutes" }]);
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
              <input
                type="number"
                name="reminderAmount"
                min={1}
                max={999}
                value={r.amount}
                onChange={(e) => updateAmount(i, e.target.value)}
                className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
              <select
                name="reminderUnit"
                value={r.unit}
                onChange={(e) => updateUnit(i, e.target.value as ReminderUnit)}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                {UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
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

// Helper to format a reminder for display: "30 minutes before".
export function formatReminder(r: Reminder): string {
  const unit =
    r.amount === 1 ? r.unit.replace(/s$/, "") : r.unit;
  return `${r.amount} ${unit} before`;
}
