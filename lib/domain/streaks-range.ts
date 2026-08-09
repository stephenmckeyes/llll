// ---------------------------------------------------------------------------
// Streaks (Grid) range types + guard. Kept server-safe (no "use client")
// so both the settings page and the home-page URL-param parser can import.
// The URL param and DB column are literally the same string.
// ---------------------------------------------------------------------------

export const STREAKS_RANGES = ["week", "month", "total", "custom"] as const;
export type StreaksRange = (typeof STREAKS_RANGES)[number];

export function isStreaksRange(v: unknown): v is StreaksRange {
  return (
    typeof v === "string" && (STREAKS_RANGES as readonly string[]).includes(v)
  );
}

export const STREAKS_RANGE_LABEL: Record<StreaksRange, string> = {
  week: "Week",
  month: "Month",
  total: "Total",
  custom: "Custom",
};
