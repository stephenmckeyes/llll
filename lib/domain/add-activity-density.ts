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

export const ADD_ACTIVITY_DENSITIES = ["default", "compact", "expanded"] as const;
export type AddActivityDensity = (typeof ADD_ACTIVITY_DENSITIES)[number];

export function isAddActivityDensity(v: unknown): v is AddActivityDensity {
  return (
    typeof v === "string" &&
    (ADD_ACTIVITY_DENSITIES as readonly string[]).includes(v)
  );
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
  default: {
    formGap: "gap-6",
    sectionMt: "mt-4",
    fieldsetPad: "p-3",
    fieldGap: "gap-2",
    inputPy: "py-2",
    showHelper: true,
  },
  compact: {
    formGap: "gap-2",
    sectionMt: "mt-2",
    fieldsetPad: "p-2",
    fieldGap: "gap-1",
    inputPy: "py-1.5",
    showHelper: false,
  },
  expanded: {
    formGap: "gap-8",
    sectionMt: "mt-6",
    fieldsetPad: "p-4",
    fieldGap: "gap-3",
    inputPy: "py-2.5",
    showHelper: true,
  },
};

export const DENSITY_LABELS: Record<
  AddActivityDensity,
  { title: string; hint: string }
> = {
  default: {
    title: "Default",
    hint: "The current layout.",
  },
  compact: {
    title: "Compact",
    hint: "Tighter gaps, smaller padding, minimal helper text — fits more on one screen.",
  },
  expanded: {
    title: "Expanded",
    hint: "Roomier spacing between sections. Best on desktop.",
  },
};
