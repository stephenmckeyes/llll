"use client";

// ---------------------------------------------------------------------------
// Reminders editor — one form section, reused by the create form and the
// edit-activity modal. Renders a list of {days, hours, minutes} rows the
// user can add / remove. Each row emits three FormData entries:
//   - reminderDays, reminderHours, reminderMinutes
// The server zips them by index (see parseRemindersFromForm).
//
// Compact mode is a completely different UI: instead of three number
// boxes per row it renders each reminder as a small pill "10m", "1h",
// "1d 30m", plus a single combobox chip (native <select> with an "…
// custom" escape hatch that prompts for arbitrary text like "1w 2d
// 3h") for adding new ones. Same shape on the server; the compact UI
// just parses the picked / typed string into the reminder shape.
// ---------------------------------------------------------------------------

import { useState } from "react";
import type { Reminder } from "@/lib/validators/reminder";

// Preset options for the compact combobox. Common enough that they
// cover most reminders; anything else falls into "Custom…" which
// prompts for a free-form string parsed by parseReminderText().
const REMINDER_PRESETS: ReadonlyArray<{ label: string; reminder: Reminder }> = [
  { label: "At time", reminder: { days: 0, hours: 0, minutes: 0 } },
  { label: "5m before", reminder: { days: 0, hours: 0, minutes: 5 } },
  { label: "10m before", reminder: { days: 0, hours: 0, minutes: 10 } },
  { label: "15m before", reminder: { days: 0, hours: 0, minutes: 15 } },
  { label: "30m before", reminder: { days: 0, hours: 0, minutes: 30 } },
  { label: "1h before", reminder: { days: 0, hours: 1, minutes: 0 } },
  { label: "2h before", reminder: { days: 0, hours: 2, minutes: 0 } },
  { label: "1d before", reminder: { days: 1, hours: 0, minutes: 0 } },
  { label: "1w before", reminder: { days: 7, hours: 0, minutes: 0 } },
];

/**
 * Parse a free-form reminder like "1d 2h 30m" / "45m" / "1w 3d" into a
 * Reminder object. Whitespace-tolerant, unit letters d/h/m/w. Weeks
 * fold into days. Returns null if nothing parses.
 */
export function parseReminderText(raw: string): Reminder | null {
  const clean = raw.trim().toLowerCase();
  if (!clean) return null;
  const match = Array.from(clean.matchAll(/(\d+)\s*([wdhm])/g));
  if (match.length === 0) return null;
  let days = 0;
  let hours = 0;
  let minutes = 0;
  for (const m of match) {
    const n = parseInt(m[1], 10);
    if (!Number.isFinite(n) || n < 0) continue;
    switch (m[2]) {
      case "w":
        days += n * 7;
        break;
      case "d":
        days += n;
        break;
      case "h":
        hours += n;
        break;
      case "m":
        minutes += n;
        break;
    }
  }
  days = Math.min(days, 30);
  hours = Math.min(hours, 23);
  minutes = Math.min(minutes, 59);
  return { days, hours, minutes };
}

export function RemindersField({
  reminders,
  setReminders,
  legendClassName,
  helperClassName,
  compact = false,
}: {
  reminders: Reminder[];
  setReminders: (next: Reminder[]) => void;
  legendClassName?: string;
  helperClassName?: string;
  /** Add-Activity compact mode (migration 0023). Uses a small combobox
   *  scroll — presets + "Custom…" text prompt — instead of the three-
   *  number rows the default mode shows. Fits inside its half of the
   *  compact "times | reminders" row. */
  compact?: boolean;
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
  function addFromPreset(preset: Reminder) {
    if (reminders.length >= 10) return;
    setReminders([...reminders, preset]);
  }
  function addFromCustomPrompt() {
    if (reminders.length >= 10) return;
    const raw = window.prompt(
      "How long before? e.g. 10m, 1h, 1d 30m, 1w 2d"
    );
    if (raw === null) return;
    const parsed = parseReminderText(raw);
    if (!parsed) {
      window.alert("Couldn't parse that — try like 10m, 1h, 1d 30m, 1w.");
      return;
    }
    setReminders([...reminders, parsed]);
  }

  if (compact) {
    return <CompactReminders reminders={reminders} onAddPreset={addFromPreset} onAddCustom={addFromCustomPrompt} onRemove={removeReminder} />;
  }

  return (
    <fieldset className={`flex flex-col ${compact ? "gap-1" : "gap-2"}`}>
      {!compact && (
        <legend className={legendClassName ?? "text-sm font-medium"}>
          Reminders
        </legend>
      )}
      {reminders.length === 0 ? (
        !compact && (
          <p className={helperClassName ?? "text-xs text-zinc-500"}>
            None. Click below to add one.
          </p>
        )
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

// ---------------------------------------------------------------------------
// Compact combobox — one condensed row of pills for each existing
// reminder + a single "+ Add" <select> that acts as a dropdown-scroll of
// presets, with a "Custom…" entry that pops window.prompt for free-form
// text (parsed by parseReminderText — supports d/h/m/w). Emits the same
// hidden inputs as the default field so the server parser is unchanged.
// ---------------------------------------------------------------------------

function CompactReminders({
  reminders,
  onAddPreset,
  onAddCustom,
  onRemove,
}: {
  reminders: Reminder[];
  onAddPreset: (r: Reminder) => void;
  onAddCustom: () => void;
  onRemove: (i: number) => void;
}) {
  // <select>'s currently-picked value; we reset to "" after every pick
  // so the same preset can be added twice in a row.
  const [pick, setPick] = useState("");
  function onChange(v: string) {
    setPick("");
    if (v === "") return;
    if (v === "__custom") {
      onAddCustom();
      return;
    }
    const idx = parseInt(v, 10);
    const preset = REMINDER_PRESETS[idx];
    if (preset) onAddPreset(preset.reminder);
  }
  const capped = reminders.length >= 10;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {reminders.map((r, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          <input type="hidden" name="reminderDays" value={r.days} />
          <input type="hidden" name="reminderHours" value={r.hours} />
          <input type="hidden" name="reminderMinutes" value={r.minutes} />
          {shortSummary(r)}
          <button
            type="button"
            onClick={() => onRemove(i)}
            aria-label="Remove reminder"
            className="rounded-full text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            ×
          </button>
        </span>
      ))}
      <select
        value={pick}
        onChange={(e) => onChange(e.target.value)}
        disabled={capped}
        aria-label="Add reminder"
        className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs font-medium disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
      >
        <option value="">
          {capped ? "+ Reminder (max 10)" : "+ Reminder"}
        </option>
        {REMINDER_PRESETS.map((p, idx) => (
          <option key={idx} value={String(idx)}>
            {p.label}
          </option>
        ))}
        <option value="__custom">Custom…</option>
      </select>
    </div>
  );
}

// Small compact-mode label: "at time", "30m", "1h 30m", "1d", "1w 2d".
function shortSummary(r: Reminder): string {
  const parts: string[] = [];
  const weeks = Math.floor(r.days / 7);
  const restDays = r.days % 7;
  if (weeks > 0) parts.push(`${weeks}w`);
  if (restDays > 0) parts.push(`${restDays}d`);
  if (r.hours > 0) parts.push(`${r.hours}h`);
  if (r.minutes > 0) parts.push(`${r.minutes}m`);
  if (parts.length === 0) return "at time";
  return parts.join(" ");
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
