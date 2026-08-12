// ---------------------------------------------------------------------------
// Add Activity form density — a per-profile visual preference (migration
// 0023). Controls how tightly the /activities/new form packs its fields.
//
// Kept as a small typed enum + a set of pre-baked Tailwind class strings
// so both the settings picker (client component) and the form (client
// component) import from the same source of truth. Read-side callers
// pass unknown text through `isAddActivityDensity` to reject anything
// outside the allowed set.
// ---------------------------------------------------------------------------

// The density picker was removed per user spec — the form now always
// renders in the (previously-optional) Compact style. Enum kept as a
// single-element union so any existing callers still type-check, and
// the DB column `profiles.add_activity_density` is preserved in case
// we want to re-introduce a picker later. Legacy DB values ("default"
// / "expanded") fail `isAddActivityDensity` and fall back to
// "compact" wherever they're read.
export const ADD_ACTIVITY_DENSITIES = ["compact"] as const;
export type AddActivityDensity = (typeof ADD_ACTIVITY_DENSITIES)[number];

export function isAddActivityDensity(v: unknown): v is AddActivityDensity {
  return v === "compact";
}

/**
 * Per-density Tailwind class fragments. Keys are the "levers" the form
 * uses; values are looked up by density.
 *
 *   formGap     → the top-level flex-col `gap-*` between form sections
 *   sectionMt   → margin-top used between adjacent sections
 *   fieldsetPad → padding inside a fieldset (rhythm config, weekdays, etc.)
 *   fieldGap    → gap between rows of inputs inside a fieldset
 *   inputPy     → vertical padding on inputs / buttons
 *   showHelper  → whether the small helper caption under a section renders
 *
 * Values are stable strings so callers can dumb-look-up: `presets[d].formGap`.
 */
export type DensityPreset = {
  formGap: string;
  sectionMt: string;
  fieldsetPad: string;
  fieldGap: string;
  inputPy: string;
  showHelper: boolean;
};

export const DENSITY_PRESETS: Record<AddActivityDensity, DensityPreset> = {
  compact: {
    formGap: "gap-2",
    sectionMt: "mt-2",
    fieldsetPad: "p-2",
    fieldGap: "gap-1",
    inputPy: "py-1.5",
    showHelper: false,
  },
};

export const DENSITY_LABELS: Record<
  AddActivityDensity,
  { title: string; hint: string }
> = {
  compact: {
    title: "Compact",
    hint: "Tighter gaps, smaller padding, minimal helper text — fits more on one screen.",
  },
};
