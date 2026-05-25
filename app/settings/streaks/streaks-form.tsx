"use client";

// ---------------------------------------------------------------------------
// StreaksForm — scope (same / independent), the global (default) mode + goal,
// a Statistics toggle, and per-activity modes when independent.
// ---------------------------------------------------------------------------

import { useState, useTransition } from "react";

import {
  updateStreakSettings,
  type StreakSettingsState,
} from "@/app/actions/streaks";
import type { StreakMode } from "@/lib/domain/streak";

const MODE_OPTIONS: ReadonlyArray<{ value: StreakMode; label: string }> = [
  { value: "none", label: "None" },
  { value: "perfect_weeks", label: "Perfect weeks" },
  { value: "perfect_months", label: "Perfect months" },
  { value: "countdown", label: "Countdown to goal" },
  { value: "total", label: "Total count" },
];

type ActivityCfg = { id: string; name: string; mode: StreakMode; goal: number | null };

const selectClasses =
  "rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const goalClasses =
  "w-20 rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export function StreaksForm({
  initialScope,
  initialMode,
  initialStats,
  initialGoal,
  activities,
}: {
  initialScope: "same" | "independent";
  initialMode: StreakMode;
  initialStats: boolean;
  initialGoal: number | null;
  activities: ActivityCfg[];
}) {
  const [scope, setScope] = useState<"same" | "independent">(initialScope);
  const [mode, setMode] = useState<StreakMode>(initialMode);
  const [goal, setGoal] = useState<string>(
    initialGoal != null ? String(initialGoal) : ""
  );
  const [stats, setStats] = useState(initialStats);
  const [perActivity, setPerActivity] = useState<ActivityCfg[]>(activities);

  const [state, setState] = useState<StreakSettingsState>(null);
  const [isPending, startTransition] = useTransition();

  function setActivity(id: string, patch: Partial<ActivityCfg>) {
    setPerActivity((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a))
    );
  }

  function save() {
    setState(null);
    startTransition(async () => {
      const res = await updateStreakSettings({
        scope,
        globalMode: mode,
        globalGoal: goal.trim() === "" ? null : Number(goal),
        stats,
        perActivity: perActivity.map((a) => ({
          id: a.id,
          mode: a.mode,
          goal: a.goal,
        })),
      });
      setState(res);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Statistics */}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={stats}
          onChange={(e) => setStats(e.target.checked)}
          className="h-4 w-4"
        />
        <span>
          <span className="font-medium">Statistics</span> — show the x/y and %
          on each activity.
        </span>
      </label>

      {/* Scope */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Streak setting</legend>
        <Radio
          checked={scope === "same"}
          onChange={() => setScope("same")}
          label="Set all streaks the same"
        />
        <Radio
          checked={scope === "independent"}
          onChange={() => setScope("independent")}
          label="Set all streaks independently"
        />
      </fieldset>

      {scope === "same" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Streak type</legend>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as StreakMode)}
              className={selectClasses}
            >
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {mode === "countdown" && (
              <GoalInput value={goal} onChange={setGoal} />
            )}
          </div>
        </fieldset>
      ) : (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-medium">
            Per-activity streak type
          </legend>
          <label className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            Default for unset / new activities:
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as StreakMode)}
              className={selectClasses}
            >
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {perActivity.length === 0 ? (
            <p className="text-sm text-zinc-500">No active activities yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {perActivity.map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {a.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      value={a.mode}
                      onChange={(e) =>
                        setActivity(a.id, {
                          mode: e.target.value as StreakMode,
                        })
                      }
                      className={selectClasses}
                    >
                      {MODE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {a.mode === "countdown" && (
                      <GoalInput
                        value={a.goal != null ? String(a.goal) : ""}
                        onChange={(v) =>
                          setActivity(a.id, {
                            goal: v.trim() === "" ? null : Number(v),
                          })
                        }
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}

      {state && "error" in state && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}
      {state && "ok" in state && (
        <p
          role="status"
          className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
        >
          Saved.
        </p>
      )}

      <button
        type="button"
        onClick={save}
        disabled={isPending}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {isPending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function GoalInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-zinc-500">
      goal
      <input
        type="number"
        min={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. 100"
        className={goalClasses}
      />
    </label>
  );
}

function Radio({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors ${
        checked
          ? "border-zinc-900 bg-zinc-100 dark:border-zinc-50 dark:bg-zinc-900"
          : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      }`}
    >
      <span
        aria-hidden
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          checked
            ? "border-zinc-900 dark:border-zinc-50"
            : "border-zinc-300 dark:border-zinc-700"
        }`}
      >
        {checked && (
          <span className="h-2 w-2 rounded-full bg-zinc-900 dark:bg-zinc-50" />
        )}
      </span>
      {label}
    </button>
  );
}
