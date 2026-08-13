"use client";

// ---------------------------------------------------------------------------
// Unified Add-Activity form with live calendar preview.
//
// All rhythm/date inputs are controlled so the preview can recompute on
// every keystroke. Submission still uses Server Action FormData — the
// controlled value attributes flow through naturally.
// ---------------------------------------------------------------------------

import { useActionState, useRef, useState, useTransition } from "react";

import {
  createActivity,
  createDraftActivity,
  type ActivityFormState,
} from "@/app/actions/activities";
import type {
  DayOfWeek,
  PeriodUnit,
  Rhythm,
} from "@/lib/validators/rhythm";

import { RemindersField } from "@/app/_components/reminders-field";
import { RolloverButtonGroup } from "@/app/_components/rollover-button-group";
import { TagPicker } from "@/app/_components/tag-picker";
import {
  DENSITY_PRESETS,
  type AddActivityDensity,
} from "@/lib/domain/add-activity-density";
import type { Reminder } from "@/lib/validators/reminder";
import type { TagMap } from "@/lib/domain/tags";

import { CalendarPreview } from "./calendar-preview";

type RhythmKind =
  | "single"
  | "selection"
  | "daily"
  | "weekdays"
  | "interval"
  | "frequency";

const WEEKDAYS: ReadonlyArray<{ value: DayOfWeek; label: string }> = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

const TODAY_ISO = new Date().toISOString().slice(0, 10);

// Default time of day for newly added activities. Noon is the most
// neutral default — neither morning nor evening, easy to adjust to
// the user's actual schedule.
const DEFAULT_TIME = "12:00";

export function ActivityForm({
  initialTagMap,
  density = "compact",
}: {
  initialTagMap: TagMap;
  /** Visual density (migration 0023 / /settings/appearance). Falls back
   *  to 'default' so existing callers stay unchanged. */
  density?: AddActivityDensity;
}) {
  // Density preset drives the top-level flex-col gap. Individual sections
  // ALSO branch on `isCompact` below — dropping headers, hiding Priority,
  // collapsing the Rhythm picker into inline chips, using the Tag
  // picker's compact mode, etc. — because the CSS-only pass only
  // tightened spacing, not structure. Compact is the "strip everything
  // non-essential" mode per user spec.
  const preset = DENSITY_PRESETS[density];
  const isCompact = density === "compact";
  const [state, formAction, isPending] = useActionState<
    ActivityFormState,
    FormData
  >(createActivity, null);

  // "Save for later" path — files the activity into the archive (Total
  // View) as a draft without putting it on any calendar. Uses an
  // imperative call (not the form's action) so it can run alongside the
  // primary "Add Activity" submit. Drafts skip most validation; only a
  // name is required.
  const formRef = useRef<HTMLFormElement>(null);
  const [draftPending, startDraft] = useTransition();
  const [draftError, setDraftError] = useState<string | null>(null);

  // Grid display flag (default off). Everything is tracked regardless — this
  // only controls whether the activity appears in the Grid view.
  const [trackOnGrid, setTrackOnGrid] = useState(false);
  // Rollover-on-missed toggles. Default rhythm is "single" so
  // `rolloverMissedDays` starts CHECKED — that means "reschedule to
  // today/tomorrow on miss" (the existing single-task behavior,
  // preserved retroactively for existing rows by migration 0022). If
  // the user switches to a recurring rhythm they can uncheck it —
  // there the checked meaning is "insert a make-up on the next day."
  const [rolloverMissedDays, setRolloverMissedDays] = useState(true);
  const [rolloverChangeRhythm, setRolloverChangeRhythm] = useState(false);
  // Auto-archive on completion (migration 0026). Default true because
  // the initial rhythm kind is single — completed one-offs move to
  // the "Past" filter in Total View so "Active" stays useful. No
  // longer user-editable in the form (users pin instead); the value
  // stays a hidden default input.
  const [autoArchive] = useState(true);
  // Pinned (migration 0035). Default false — user opts in for
  // activities they may want to re-initiate. Default filter in Total
  // View surfaces pinned activities across Active / Past / Archived.
  const [pinned, setPinned] = useState(false);

  function handleSaveForLater() {
    const form = formRef.current;
    if (!form) return;
    // A name is the one thing a draft needs (to find it later). Surface
    // the native "please fill this in" on the name field if it's empty.
    const nameInput = form.querySelector<HTMLInputElement>(
      'input[name="name"]'
    );
    if (nameInput && !nameInput.value.trim()) {
      nameInput.reportValidity();
      return;
    }
    const ok = window.confirm(
      "Save this as a draft for later?\n\n" +
        "It will be parked in Total View → Archived (not on any calendar) " +
        "so you can finish it when you're ready. To activate it later, open " +
        "Total View, find it under Archived, and choose Unarchive."
    );
    if (!ok) return;
    setDraftError(null);
    const fd = new FormData(form);
    startDraft(async () => {
      // On success the action redirects to /activities; on failure it
      // returns { error }.
      const res = await createDraftActivity(null, fd);
      if (res && "error" in res) setDraftError(res.error);
    });
  }

  // ---- Controlled inputs that the preview depends on --------------------
  //
  // Number inputs use *string* state so the user can clear the field and
  // retype without the value snapping back to the previous number on every
  // keystroke. We coerce to a sensible number for the preview only.
  const [name, setName] = useState<string>("");
  const [rhythmKind, setRhythmKind] = useState<RhythmKind>("single");
  const [weekdays, setWeekdays] = useState<DayOfWeek[]>([]);
  const [intervalDaysStr, setIntervalDaysStr] = useState<string>("2");
  const [frequencyCountStr, setFrequencyCountStr] = useState<string>("3");
  const [frequencyPerCountStr, setFrequencyPerCountStr] = useState<string>("1");
  const [frequencyPerUnit, setFrequencyPerUnit] =
    useState<PeriodUnit>("weeks");
  // Times of day. ALL rhythms (except Once) can have multiple — adding
  // more than one makes the activity "multi" (annotated in the Grid
  // view's Type column). For Daily specifically the server converts
  // multi-time to a frequency rhythm with count = times.length so the
  // existing X/Y progress UI on the Day list still works.
  // Time of day is optional — start with none. An activity with no set
  // time sorts to the end of the day on the Day + Week views.
  const [scheduledTimes, setScheduledTimes] = useState<string[]>([]);
  // Parallel array (migration 0032). "" = no end for that slot.
  const [scheduledEndTimes, setScheduledEndTimes] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<string>(TODAY_ISO);
  const [endDate, setEndDate] = useState<string>("");
  const [reminders, setReminders] = useState<Reminder[]>([]);
  // Unrhythmic Selection: extra start dates BEYOND the primary one.
  // Each entry produces an additional `single` activity sharing every
  // other field. See createActivity's "selection" branch for the
  // server-side fan-out.
  const [extraStartDates, setExtraStartDates] = useState<string[]>([]);

  // Parsed numbers for preview computation. Empty / invalid input falls
  // back to 1 so the calendar still renders something while you're typing.
  const intervalDays = Math.max(1, parseInt(intervalDaysStr, 10) || 1);
  const frequencyCount = Math.max(1, parseInt(frequencyCountStr, 10) || 1);
  const frequencyPerCount = Math.max(
    1,
    parseInt(frequencyPerCountStr, 10) || 1
  );

  const isSingle = rhythmKind === "single";
  const isSelection = rhythmKind === "selection";
  // "selection" is shown to the server as a flag — each picked date
  // becomes its own `single` activity. So for the preview / end-date
  // logic, treat selection the same as single.
  const isSingleLike = isSingle || isSelection;

  // Force end_date == start_date for singles (the server enforces this too).
  const effectiveEndDate = isSingleLike ? startDate : endDate || null;

  // Compute the rhythm shape the preview should render.
  const previewRhythm = derivePreviewRhythm({
    kind: rhythmKind,
    weekdays,
    intervalDays,
    frequencyCount,
    frequencyPerCount,
    frequencyPerUnit,
    scheduledTimes,
  });

  // ---- Times-of-day handlers --------------------------------------------
  function updateScheduledTime(i: number, value: string) {
    setScheduledTimes((prev) => prev.map((t, idx) => (idx === i ? value : t)));
  }
  function updateScheduledEndTime(i: number, value: string) {
    setScheduledEndTimes((prev) =>
      prev.map((t, idx) => (idx === i ? value : t))
    );
  }
  function clearScheduledEndTime(i: number) {
    updateScheduledEndTime(i, "");
  }
  function addScheduledTime() {
    setScheduledTimes((prev) => [...prev, DEFAULT_TIME]);
    setScheduledEndTimes((prev) => [...prev, ""]);
  }
  function removeScheduledTime(i: number) {
    // Optional now — removing the last time is allowed (no set time).
    setScheduledTimes((prev) => prev.filter((_, idx) => idx !== i));
    setScheduledEndTimes((prev) => prev.filter((_, idx) => idx !== i));
  }

  // ---- Weekday checkbox handler -----------------------------------------
  function toggleWeekday(day: DayOfWeek) {
    setWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  // ---- Selection extra-date handlers ------------------------------------
  function addExtraStartDate() {
    setExtraStartDates((prev) => [...prev, TODAY_ISO]);
  }
  function updateExtraStartDate(i: number, value: string) {
    setExtraStartDates((prev) =>
      prev.map((d, idx) => (idx === i ? value : d))
    );
  }
  function removeExtraStartDate(i: number) {
    setExtraStartDates((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    // w-full forces the form to always occupy the full max-w-xl of its
    // parent, regardless of its children's intrinsic width. Without this,
    // a flex-col form sizes to its max-content — so when wider conditional
    // sections appeared/disappeared (Weekdays chips, long typed names),
    // the form's width changed and mx-auto centering shifted it sideways.
    <form
      ref={formRef}
      action={formAction}
      // data-density scopes the density-related CSS in globals.css to
      // this form only, without threading a `density` prop through
      // every section. The `default` value has no CSS overrides.
      data-density={density}
      onKeyDown={(e) => {
        // Don't let Enter inside an input submit the form. Only the
        // explicit "Add Activity" button should submit. Textareas keep
        // their normal newline behavior; the submit button still
        // activates on Enter when focused.
        const target = e.target as HTMLElement;
        if (
          e.key === "Enter" &&
          target.tagName !== "TEXTAREA" &&
          target.tagName !== "BUTTON"
        ) {
          e.preventDefault();
        }
      }}
      className={`flex w-full max-w-full min-w-0 flex-col ${preset.formGap}`}
    >
      {/* Track-on-Grid state travels through FormData via a hidden input;
          the visible section moved to the bottom of the form (below). */}
      <input
        type="hidden"
        name="trackOnGrid"
        value={trackOnGrid ? "true" : "false"}
      />

      {/* Compact hides the Priority radios entirely; ship a
          Medium-priority default so the server-side schema still gets
          a valid value. PriorityRadio (default) uses `defaultChecked
          value="2"` for the same result, so behavior is preserved. */}
      {isCompact && (
        <input type="hidden" name="priority" value="2" />
      )}

      {/* --- 1. Activity (name) ---------------------------------------- */}
      {isCompact ? (
        <input
          type="text"
          name="name"
          required
          maxLength={120}
          placeholder="Activity name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClasses}
        />
      ) : (
        <FieldLabel label="Activity">
          <input
            type="text"
            name="name"
            required
            maxLength={120}
            placeholder="Morning run"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClasses}
          />
        </FieldLabel>
      )}

      {/* --- 2. Notes -------------------------------------------------- */}
      {isCompact ? (
        <textarea
          name="notes"
          rows={2}
          maxLength={500}
          placeholder="Notes"
          className={`${inputClasses} resize-none`}
        />
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Notes</legend>
          <textarea
            name="notes"
            rows={2}
            maxLength={500}
            placeholder="Notes, links, sub-steps…"
            className={`${inputClasses} resize-none`}
          />
        </fieldset>
      )}

      {/* --- 3. Tags --------------------------------------------------- */}
      {isCompact ? (
        <TagPicker initialTagMap={initialTagMap} compact />
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Tags</legend>
          <TagPicker initialTagMap={initialTagMap} />
        </fieldset>
      )}

      {/* --- 3. Rhythm ------------------------------------------------- */}
      {/* Hidden input mirrors React state for FormData. The visible
          controls below are buttons (not native <input type=radio>) because
          iOS Safari has been unreliable about firing onChange when a label-
          wrapped radio gets tapped, so the conditional rhythm config wasn't
          appearing on phones. Buttons + state-driven highlight always work. */}
      <input type="hidden" name="rhythmType" value={rhythmKind} />
      {/* Compact: inline chip flow, buttons sized to text, no radio dot,
          highlight-only selection. Default keeps the tall stacked radios
          (also gets a CSS 2-col grid via globals.css). */}
      {isCompact ? (
        <div
          data-form-section="rhythm"
          className="flex flex-wrap gap-1"
        >
          {(
            [
              ["single", "Once"],
              ["selection", "Pick Dates"],
              ["daily", "Daily"],
              ["weekdays", "Days per Week"],
              ["interval", "Every N Days"],
              ["frequency", "Target Count"],
            ] as const
          ).map(([value, label]) => {
            const selected = rhythmKind === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setRhythmKind(value)}
                className={`touch-manipulation rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  selected
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : (
        /* Marked so Compact density can restructure this fieldset into a
           2-column grid via globals.css when isCompact is false but the
           CSS-only density path (Default → Expanded) still applies. */
        <fieldset data-form-section="rhythm" className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Rhythm</legend>
          <RhythmRadio value="single" current={rhythmKind} onChange={setRhythmKind} label="Once" />
          <RhythmRadio
            value="selection"
            current={rhythmKind}
            onChange={setRhythmKind}
            label="Pick Dates"
            hint="Several one-offs, shared details"
          />
          <RhythmRadio value="daily" current={rhythmKind} onChange={setRhythmKind} label="Daily" />
          <RhythmRadio
            value="weekdays"
            current={rhythmKind}
            onChange={setRhythmKind}
            label="Days per Week"
          />
          <RhythmRadio
            value="interval"
            current={rhythmKind}
            onChange={setRhythmKind}
            label="Every N Days"
          />
          <RhythmRadio
            value="frequency"
            current={rhythmKind}
            onChange={setRhythmKind}
            label="Target Count"
          />
        </fieldset>
      )}

      {/* Conditional rhythm config */}
      {rhythmKind === "weekdays" && (
        <ConfigBox column>
          <p className="text-xs text-zinc-500">Pick at least one.</p>
          {/* Hidden inputs mirror state for FormData (server reads getAll("weekday")). */}
          {weekdays.map((day) => (
            <input key={day} type="hidden" name="weekday" value={day} />
          ))}
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => {
              const selected = weekdays.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleWeekday(d.value)}
                  className={`touch-manipulation rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    selected
                      ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                      : "border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </ConfigBox>
      )}

      {rhythmKind === "interval" && (
        <ConfigBox>
          <span className="text-sm">Every</span>
          <input
            type="number"
            name="intervalDays"
            min={1}
            max={365}
            value={intervalDaysStr}
            onChange={(e) => setIntervalDaysStr(e.target.value)}
            onBlur={(e) => {
              // Snap back to a valid number when the user leaves the field.
              const n = parseInt(e.target.value, 10);
              setIntervalDaysStr(
                Number.isFinite(n) && n >= 1 ? String(Math.min(n, 365)) : "1"
              );
            }}
            className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="text-sm">days</span>
          {intervalDays > 1 && (
            <span className="text-xs text-zinc-500">
              ({intervalDays - 1} day{intervalDays - 1 === 1 ? "" : "s"} rest)
            </span>
          )}
        </ConfigBox>
      )}

      {rhythmKind === "frequency" && (
        <ConfigBox>
          <input
            type="number"
            name="frequencyCount"
            min={1}
            max={99}
            value={frequencyCountStr}
            onChange={(e) => setFrequencyCountStr(e.target.value)}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              setFrequencyCountStr(
                Number.isFinite(n) && n >= 1 ? String(Math.min(n, 99)) : "1"
              );
            }}
            className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="text-sm">times per</span>
          <input
            type="number"
            name="frequencyPerCount"
            min={1}
            max={99}
            value={frequencyPerCountStr}
            onChange={(e) => setFrequencyPerCountStr(e.target.value)}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              setFrequencyPerCountStr(
                Number.isFinite(n) && n >= 1 ? String(Math.min(n, 99)) : "1"
              );
            }}
            className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <select
            name="frequencyPerUnit"
            value={frequencyPerUnit}
            onChange={(e) =>
              setFrequencyPerUnit(e.target.value as PeriodUnit)
            }
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="days">{frequencyPerCount === 1 ? "day" : "days"}</option>
            <option value="weeks">{frequencyPerCount === 1 ? "week" : "weeks"}</option>
            <option value="months">{frequencyPerCount === 1 ? "month" : "months"}</option>
          </select>
        </ConfigBox>
      )}

      {/* --- 4. Schedule ----------------------------------------------- */}
      <fieldset className="flex flex-col gap-3">
        {!isCompact && (
          <legend className="mb-1 text-sm font-medium">Schedule</legend>
        )}
        <div className={`grid grid-cols-2 ${isCompact ? "gap-2" : "gap-3"}`}>
          {isCompact ? (
            <>
              <div className="flex flex-col gap-0.5">
                <input
                  type="date"
                  name="startDate"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={inputClasses}
                />
                <span className="px-1 text-[10px] text-zinc-500">(Start)</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <div className="relative">
                  <input
                    type="date"
                    name="endDate"
                    value={isSingleLike ? "" : endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    disabled={isSingleLike}
                    className={`${inputClasses} pr-7`}
                  />
                  {!isSingleLike && endDate && (
                    <button
                      type="button"
                      onClick={() => setEndDate("")}
                      aria-label="Clear end date (indefinite)"
                      title="No end date"
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      ×
                    </button>
                  )}
                </div>
                <span className="px-1 text-[10px] text-zinc-500">(End)</span>
              </div>
            </>
          ) : (
            <>
              <FieldLabel label="Start date">
                <input
                  type="date"
                  name="startDate"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className={inputClasses}
                />
              </FieldLabel>
              <FieldLabel
                label={
                  <>
                    End date{" "}
                    <span className="font-normal text-zinc-500">
                      {isSingleLike ? "(n/a)" : "(optional)"}
                    </span>
                  </>
                }
              >
                <div className="relative">
                  <input
                    type="date"
                    name="endDate"
                    value={isSingleLike ? "" : endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    disabled={isSingleLike}
                    className={`${inputClasses} pr-8`}
                  />
                  {!isSingleLike && endDate && (
                    <button
                      type="button"
                      onClick={() => setEndDate("")}
                      aria-label="Clear end date (indefinite)"
                      title="No end date"
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      ×
                    </button>
                  )}
                </div>
                {!isSingleLike && (
                  <button
                    type="button"
                    onClick={() => setEndDate("")}
                    disabled={!endDate}
                    className="mt-1 text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700 disabled:opacity-40 disabled:no-underline dark:hover:text-zinc-300"
                  >
                    No end date (indefinite)
                  </button>
                )}
              </FieldLabel>
            </>
          )}
        </div>

        {/* Selection mode: list of extra dates, each producing its own
            single activity. Submitted as additional `startDate` form
            values; the server splits them in createActivity. */}
        {isSelection && (
          <ConfigBox column>
            {!isCompact && (
              <p className="text-xs text-zinc-500">
                Each additional date becomes a separate one-time activity
                sharing the name, notes, tags, time, priority, and reminders
                above.
              </p>
            )}
            {extraStartDates.length > 0 && (
              <ul className="flex flex-col gap-2">
                {extraStartDates.map((d, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <input
                      type="date"
                      name="startDate"
                      value={d}
                      onChange={(e) => updateExtraStartDate(i, e.target.value)}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                    />
                    <button
                      type="button"
                      onClick={() => removeExtraStartDate(i)}
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={addExtraStartDate}
              className="self-start rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              + Add date
            </button>
          </ConfigBox>
        )}

        {/* Times of day — every rhythm gets the multi-row list.
            "X times per day" comes for free since the user can add /
            remove rows. Behavioral mapping:
              - Once / Selection: each picked date gets all listed times
              - Daily + multi: server converts to a frequency rhythm so
                the X/Y progress UI still works
              - Weekdays / Interval / Frequency + multi: rhythm stays
                as-is; multi-times are stored on scheduled_times[].
                The Grid view's Type column annotates "Multi {rhythm}"
                whenever scheduled_times.length > 1. */}
        {isCompact ? (
          /* Compact: Times + Reminders share one flex-wrap row with a
             vertical divider. The section-6 Reminders below renders
             nothing in Compact so it isn't duplicated. */
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {scheduledTimes.map((t, i) => (
                <span key={i} className="flex items-center gap-1">
                  <input
                    type="time"
                    name="scheduledTime"
                    value={t}
                    onChange={(e) => updateScheduledTime(i, e.target.value)}
                    className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <span aria-hidden className="text-xs text-zinc-400">
                    –
                  </span>
                  <input
                    type="hidden"
                    name="scheduledEndTime"
                    value={scheduledEndTimes[i] ?? ""}
                  />
                  <input
                    type="time"
                    value={scheduledEndTimes[i] ?? ""}
                    onChange={(e) =>
                      updateScheduledEndTime(i, e.target.value)
                    }
                    title="End (optional)"
                    className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  {scheduledEndTimes[i] && (
                    <button
                      type="button"
                      onClick={() => clearScheduledEndTime(i)}
                      aria-label="Clear end time"
                      title="No end time"
                      className="rounded-md border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      ×
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeScheduledTime(i)}
                    aria-label="Remove time"
                    className="rounded-md border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  >
                    ×
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={addScheduledTime}
                className="rounded-md border border-zinc-300 px-2 py-0.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                + Add time
              </button>
            </div>
            <span
              aria-hidden
              className="h-4 w-px shrink-0 bg-zinc-300 dark:bg-zinc-700"
            />
            <RemindersField
              reminders={reminders}
              setReminders={setReminders}
              compact
            />
          </div>
        ) : (
          <FieldLabel
            label={
              <>
                Times of day{" "}
                <span className="font-normal text-zinc-500">
                  {scheduledTimes.length > 0
                    ? `(${scheduledTimes.length} per day)`
                    : "(optional)"}
                </span>
              </>
            }
          >
            {scheduledTimes.length === 0 && (
              <p className="text-xs text-zinc-500">
                No set time — this sorts to the end of the day.
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {scheduledTimes.map((t, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    type="time"
                    name="scheduledTime"
                    value={t}
                    onChange={(e) => updateScheduledTime(i, e.target.value)}
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <span aria-hidden className="text-sm text-zinc-400">
                    –
                  </span>
                  <input
                    type="hidden"
                    name="scheduledEndTime"
                    value={scheduledEndTimes[i] ?? ""}
                  />
                  <input
                    type="time"
                    value={scheduledEndTimes[i] ?? ""}
                    onChange={(e) =>
                      updateScheduledEndTime(i, e.target.value)
                    }
                    placeholder="End"
                    title="End (optional)"
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  {scheduledEndTimes[i] && (
                    <button
                      type="button"
                      onClick={() => clearScheduledEndTime(i)}
                      aria-label="Clear end time"
                      title="No end time"
                      className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                    >
                      No end
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeScheduledTime(i)}
                    className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={addScheduledTime}
              className="mt-2 self-start rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              + Add time
            </button>
          </FieldLabel>
        )}

        {!isSingleLike && (
          <p className="text-xs text-zinc-500">
            Leave end date blank for an open-ended rhythm.
          </p>
        )}
      </fieldset>

      {/* --- 5. Priority (only for Once / Selection; hidden in Compact) - */}
      {/* Compact strips Priority entirely per the "just show + Add
          reminder" / "hide headers" spec. A hidden default (Medium =
          "2") still submits because the underlying <PriorityRadio>
          radios were `defaultChecked` on Medium; on Compact submit,
          FormData.get("priority") returns "2" as a fallback via the
          Zod default in the server action. */}
      {!isCompact && isSingleLike && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Priority</legend>
          <div className="flex gap-2">
            <PriorityRadio value="1" label="High" />
            <PriorityRadio value="2" label="Medium" defaultChecked />
            <PriorityRadio value="3" label="Low" />
          </div>
        </fieldset>
      )}

      {/* --- 6. Reminders ---------------------------------------------- */}
      {/* Compact renders Reminders inline with Times above (one
          combined "when this fires" row). Default keeps the full
          RemindersField block here. */}
      {!isCompact && (
        <RemindersField reminders={reminders} setReminders={setReminders} />
      )}

      {/* --- 7. Show on Streaks (moved to bottom per user request) ---- */}
      {/* Compact: drop the "Streaks" legend + fieldset border, keep
          just two tight toggle buttons on one row. */}
      {isCompact ? (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setTrackOnGrid(false)}
            className={`flex-1 touch-manipulation rounded-md border px-2 py-1 text-center text-xs font-medium transition-colors ${
              !trackOnGrid
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            Off Streaks
          </button>
          <button
            type="button"
            onClick={() => setTrackOnGrid(true)}
            className={`flex-1 touch-manipulation rounded-md border px-2 py-1 text-center text-xs font-medium transition-colors ${
              trackOnGrid
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            On Streaks
          </button>
        </div>
      ) : (
        <fieldset className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">Streaks</legend>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTrackOnGrid(false)}
              className={`flex-1 touch-manipulation rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                !trackOnGrid
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              Don&rsquo;t show on Streaks
            </button>
            <button
              type="button"
              onClick={() => setTrackOnGrid(true)}
              className={`flex-1 touch-manipulation rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                trackOnGrid
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              Show on Streaks
            </button>
          </div>
        </fieldset>
      )}

      {/* --- 7b. Pinned (migration 0035) ------------------------------ */}
      {/* Replaces the old Keep-on-Active / Auto-archive toggle per user
          spec. Pinned = "I might want to re-initiate this later"; shows
          up as the DEFAULT filter in Total View. Auto-archive still
          runs per-rhythm under the hood (hidden input, always default),
          so a pinned single still archives on complete — but stays
          surfaced via Pinned. */}
      <input
        type="hidden"
        name="autoArchive"
        value={autoArchive ? "true" : "false"}
      />
      <input
        type="hidden"
        name="pinned"
        value={pinned ? "true" : "false"}
      />
      {isCompact ? (
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setPinned(false)}
            aria-pressed={!pinned}
            className={`flex-1 touch-manipulation rounded-md border px-2 py-1 text-center text-xs font-medium transition-colors ${
              !pinned
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            Not pinned
          </button>
          <button
            type="button"
            onClick={() => setPinned(true)}
            aria-pressed={pinned}
            className={`flex-1 touch-manipulation rounded-md border px-2 py-1 text-center text-xs font-medium transition-colors ${
              pinned
                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            📌 Pinned on Total View
          </button>
        </div>
      ) : (
        <fieldset className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <legend className="px-1 text-sm font-medium">Pinned on Total View</legend>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPinned(false)}
              aria-pressed={!pinned}
              className={`flex-1 touch-manipulation rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                !pinned
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              Not pinned
            </button>
            <button
              type="button"
              onClick={() => setPinned(true)}
              aria-pressed={pinned}
              className={`flex-1 touch-manipulation rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors ${
                pinned
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                  : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              📌 Pinned
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Pin activities you may want to re-initiate. Pinned is the
            default view in Total, so pinned items stay one tap away
            even after they complete.
          </p>
        </fieldset>
      )}

      {/* --- 8. Rollover on missed ------------------------------------ */}
      {/* Shown for EVERY rhythm now — singles get a single "Rollover
          missed days" toggle (default on = reschedule instead of
          finalising as missed); recurring rhythms get both toggles
          (defaults off). "Change rhythm" is hidden for singles because
          there's no rhythm to shift. */}
      <input
        type="hidden"
        name="rolloverMissedDays"
        value={rolloverMissedDays ? "true" : "false"}
      />
      <input
        type="hidden"
        name="rolloverChangeRhythm"
        value={rolloverChangeRhythm ? "true" : "false"}
      />
      {/* Yes/No highlighted buttons in both densities (matching the
          Streaks and Pinned toggles) — the compact prop just shrinks
          them. Replaces the old bare checkboxes. */}
      <RolloverButtonGroup
        // The standalone form's RhythmKind adds "selection" (Pick Dates)
        // which the shared type doesn't; treat it as single for the
        // button-group purposes since it too is a fixed set of dates.
        rhythmKind={isSelection ? "single" : rhythmKind}
        rolloverMissedDays={rolloverMissedDays}
        setRolloverMissedDays={setRolloverMissedDays}
        rolloverChangeRhythm={rolloverChangeRhythm}
        setRolloverChangeRhythm={setRolloverChangeRhythm}
        compact={isCompact}
      />

      {/* --- Calendar preview ------------------------------------------ */}
      {/* Kept visible in every density. Compact CSS in globals.css
          (see form[data-density=compact] [data-form-section=
          calendar-preview]) shrinks the cells + padding so it doesn't
          dominate. */}
      <CalendarPreview
        rhythm={previewRhythm}
        startDate={startDate}
        endDate={effectiveEndDate}
        activityName={name}
        reminders={reminders}
        // Selection's "+ Add date" entries land on the preview as
        // extra scheduled cells; dates outside the 35-day window are
        // surfaced as a "+ N more" notice instead.
        extraDates={isSelection ? extraStartDates : undefined}
      />

      {/* Error */}
      {state && "error" in state && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </p>
      )}
      {draftError && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {draftError}
        </p>
      )}

      {/* Sticky action bar — pinned to the viewport bottom while the form
          scrolls, so "Add Activity" / "Save for later" are always one tap
          away without hunting through a long form. Sits at its natural
          position once the form fits in one screen.
          - -mx-6 bleeds through the parent <main>'s p-6 so the bar meets
            the viewport edges on mobile (main.max-w-xl fills the screen
            below the xl breakpoint).
          - Opaque bg + top border so scrolling content doesn't show
            through. z-20 keeps it above form content and the header (the
            page's sticky header uses z-30).
          - safe-area-inset-bottom padding respects the iOS home indicator. */}
      <div
        className="sticky bottom-0 z-20 -mx-6 flex flex-wrap justify-end gap-2 border-t border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-950"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        {/* Save-for-later on the LEFT of the right-aligned pair so
            Add Activity — the primary action — sits at the far right
            edge where the thumb naturally lands (per user spec:
            "make the add activity and save for later buttons on the
            right bottom side"). */}
        <button
          type="button"
          onClick={handleSaveForLater}
          disabled={isPending || draftPending}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {draftPending ? "Saving…" : "Save for later"}
        </button>
        <button
          type="submit"
          disabled={isPending || draftPending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {isPending ? "Adding…" : "Add Activity"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Derive a valid Rhythm object from current form state, or null if the
// shape isn't complete enough yet (e.g. weekdays with no day selected).
// ---------------------------------------------------------------------------

function derivePreviewRhythm({
  kind,
  weekdays,
  intervalDays,
  frequencyCount,
  frequencyPerCount,
  frequencyPerUnit,
  scheduledTimes,
}: {
  kind: RhythmKind;
  weekdays: DayOfWeek[];
  intervalDays: number;
  frequencyCount: number;
  frequencyPerCount: number;
  frequencyPerUnit: PeriodUnit;
  scheduledTimes: string[];
}): Rhythm | null {
  const validTimes = scheduledTimes.filter((t) => /^\d{2}:\d{2}$/.test(t));
  switch (kind) {
    case "single":
    case "selection":
      // Selection fans out to multiple `single` activities server-side;
      // for the calendar preview we just show the primary date's single.
      return { type: "single" };
    case "daily":
      // Multi-time daily → behaves like the old Multi-Daily (frequency
      // count = N on a 1-day period). The server applies the same
      // conversion on submit.
      if (validTimes.length > 1) {
        return {
          type: "frequency",
          count: validTimes.length,
          perCount: 1,
          perUnit: "days",
        };
      }
      return { type: "daily" };
    case "weekdays":
      return weekdays.length === 0
        ? null
        : { type: "weekdays", days: weekdays };
    case "interval":
      return intervalDays >= 1
        ? { type: "interval", days: intervalDays }
        : null;
    case "frequency":
      return frequencyCount >= 1
        ? {
            type: "frequency",
            count: frequencyCount,
            perCount: frequencyPerCount,
            perUnit: frequencyPerUnit,
          }
        : null;
  }
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

// `w-full` so inputs always stretch to the form's max width.
// `min-w-0` is critical — inputs have an intrinsic min-width based on
// their `size` attribute or content; without min-w-0 they can refuse to
// shrink and push the parent wider.
const inputClasses =
  "w-full min-w-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-50 dark:disabled:bg-zinc-950";

function FieldLabel({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  // min-w-0 so this label, when nested in a grid (e.g. the 2-col Schedule
  // section), can shrink below its content's intrinsic width instead of
  // forcing the grid to widen.
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

function RhythmRadio({
  value,
  current,
  onChange,
  label,
  hint,
}: {
  value: RhythmKind;
  current: RhythmKind;
  onChange: (v: RhythmKind) => void;
  label: string;
  hint?: string;
}) {
  const selected = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      className={`flex w-full touch-manipulation items-center justify-between gap-2 rounded-md border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
        selected
          ? "border-zinc-900 bg-zinc-100 dark:border-zinc-50 dark:bg-zinc-900"
          : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      }`}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
            selected
              ? "border-zinc-900 dark:border-zinc-50"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        >
          {selected && (
            <span className="h-2 w-2 rounded-full bg-zinc-900 dark:bg-zinc-50" />
          )}
        </span>
        <span>{label}</span>
      </span>
      {hint && (
        <span className="text-xs font-normal text-zinc-500">{hint}</span>
      )}
    </button>
  );
}

function ConfigBox({
  children,
  column = false,
}: {
  children: React.ReactNode;
  column?: boolean;
}) {
  return (
    <div
      className={`flex w-full min-w-0 ${
        column ? "flex-col" : "flex-wrap items-center"
      } gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800`}
    >
      {children}
    </div>
  );
}

function PriorityRadio({
  value,
  label,
  defaultChecked = false,
}: {
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  // Native radio kept (just visually hidden) so FormData picks up the value
  // without needing extra React state for this 1-of-3 choice. The visible
  // button beside it is what receives taps reliably on iOS.
  return (
    <label className="relative flex-1 cursor-pointer">
      <input
        type="radio"
        name="priority"
        value={value}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <span className="block touch-manipulation rounded-md border border-zinc-300 px-3 py-2 text-center text-sm font-medium peer-checked:border-zinc-900 peer-checked:bg-zinc-900 peer-checked:text-white dark:border-zinc-700 dark:peer-checked:border-zinc-50 dark:peer-checked:bg-zinc-50 dark:peer-checked:text-zinc-900">
        {label}
      </span>
    </label>
  );
}
